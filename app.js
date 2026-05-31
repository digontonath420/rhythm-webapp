/* ── STATE ── */
let audioUrl     = null;
let audioCtx     = null;
let analyser     = null;
let sourceNode   = null;
let activeAudio  = null;
let isRendering  = false;
let mediaRecorder= null;
let rafId        = null;

const canvas = document.getElementById('videoCanvas');
const ctx    = canvas.getContext('2d', { willReadFrequently: false });

/* Canvas resolution — kept at half of 1080p for smooth perf on low-RAM phones */
const CANVAS_W = 540;
const CANVAS_H = 960;
canvas.width  = CANVAS_W;
canvas.height = CANVAS_H;

const hypeElements = ["🔥","⚡","👑","💎","✨","🎵","💥","🚀"];
let currentEl = "🔥";
let lastBeat  = 0;

/* ── DOM REFS ── */
const dropZone     = document.getElementById('dropZone');
const audioUpload  = document.getElementById('audioUpload');
const controlsCard = document.getElementById('controlsCard');
const previewBox   = document.getElementById('previewBox');
const btnReset     = document.getElementById('btnReset');
const btnPlay      = document.getElementById('btnPlay');
const btnRender    = document.getElementById('btnRender');
const btnStop      = document.getElementById('btnStop');
const renderStatus = document.getElementById('renderStatus');

/* ── FILE UPLOAD ── */
dropZone.addEventListener('click', () => audioUpload.click());
dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') audioUpload.click();
});

audioUpload.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    stopEverything();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(file);
    document.getElementById('fileInfo').textContent = file.name;
    dropZone.classList.add('hidden');
    controlsCard.classList.remove('hidden');
    previewBox.classList.add('hidden');
});

btnReset.addEventListener('click', e => {
    e.stopPropagation();
    stopEverything();
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    audioUpload.value = '';
    controlsCard.classList.add('hidden');
    previewBox.classList.add('hidden');
    dropZone.classList.remove('hidden');
    /* Destroy AudioContext fully to free memory */
    if (audioCtx) {
        audioCtx.close();
        audioCtx = null;
        analyser = null;
        sourceNode = null;
    }
});

/* ── AUDIO HELPERS ── */
function stopEverything() {
    isRendering = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch(e) {}
    }
    if (activeAudio) {
        activeAudio.pause();
        activeAudio.src = '';
        activeAudio = null;
    }
    btnRender.disabled = false;
    btnPlay.disabled   = false;
}

function getOrCreateAudioCtx(audioEl) {
    /* Reuse existing context — avoids "too many AudioContexts" crash on mobile */
    if (audioCtx && audioCtx.state !== 'closed') {
        if (sourceNode) { try { sourceNode.disconnect(); } catch(e) {} }
        sourceNode = audioCtx.createMediaElementSource(audioEl);
        sourceNode.connect(analyser);
        return;
    }
    /* sampleRate: 22050 = half of default → halves DSP CPU load */
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 22050 });
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 32;              /* minimum bins — only bass needed; big perf win */
    analyser.smoothingTimeConstant = 0.75;
    sourceNode = audioCtx.createMediaElementSource(audioEl);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
}

/* ── PREVIEW (LISTEN) ── */
btnPlay.addEventListener('click', () => {
    if (!audioUrl) return;
    stopEverything();
    activeAudio = new Audio(audioUrl);
    getOrCreateAudioCtx(activeAudio);
    if (audioCtx.state === 'suspended') audioCtx.resume();
    activeAudio.play().catch(() => alert('Tap the button again to play audio.'));
    previewBox.classList.add('hidden');
});

/* ── RENDER VIDEO ── */
btnRender.addEventListener('click', () => {
    if (!audioUrl) return;
    stopEverything();

    activeAudio = new Audio(audioUrl);
    getOrCreateAudioCtx(activeAudio);
    if (audioCtx.state === 'suspended') audioCtx.resume();

    previewBox.classList.remove('hidden');
    renderStatus.textContent = 'Recording…';
    isRendering = true;
    btnRender.disabled = true;

    const bgType      = document.getElementById('bgType').value;
    const visualStyle = document.getElementById('visualStyle').value;

    /* ── MediaRecorder setup ── */
    const stream = canvas.captureStream(24); /* 24fps — lighter than 30 */

    /* Try formats from best to most-compatible fallback */
    const mimeTypes = [
        'video/mp4;codecs=avc1',
        'video/mp4',
        'video/webm;codecs=vp8',
        'video/webm'
    ];
    let chosenMime = '';
    for (const m of mimeTypes) {
        if (MediaRecorder.isTypeSupported(m)) { chosenMime = m; break; }
    }

    let chunks = [];
    mediaRecorder = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime, videoBitsPerSecond: 800_000 })
        : new MediaRecorder(stream, { videoBitsPerSecond: 800_000 });

    /* Collect in 500ms chunks — prevents memory spike from one giant blob */
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    mediaRecorder.onstop = () => {
        if (chunks.length === 0) return;
        const ext  = mediaRecorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
        chunks = []; /* free memory immediately */
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = url;
        a.download = `rhythm_beat.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        renderStatus.textContent = 'Done! Check your downloads.';
        isRendering = false;
        btnRender.disabled = false;
    };

    mediaRecorder.start(500);

    const dataArr = new Uint8Array(analyser.frequencyBinCount);

    /* ── RENDER LOOP ── */
    let frameCount = 0;

    function renderFrame() {
        if (!isRendering) return;
        if (activeAudio && activeAudio.ended) {
            stopAndFinish();
            return;
        }

        /* Skip every other frame → effective ~12fps; still smooth for music visuals */
        frameCount++;
        if (frameCount % 2 === 0) {
            rafId = requestAnimationFrame(renderFrame);
            return;
        }

        analyser.getByteFrequencyData(dataArr);

        /* Bass = average of first 2 frequency bins */
        const bass = (dataArr[0] + dataArr[1]) >> 1;

        /* Draw background */
        if (bgType === 'transparent') {
            ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        } else {
            ctx.fillStyle = '#00FF00'; /* standard chroma green */
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        }

        const now   = performance.now();
        const scale = 1 + (bass / 255) * 0.45;

        /* Beat detection — swap emoji on strong bass hits */
        if (bass > 185 && (now - lastBeat) > 250) {
            currentEl = hypeElements[Math.floor(Math.random() * hypeElements.length)];
            lastBeat  = now;
        }

        ctx.save();
        ctx.translate(CANVAS_W / 2, CANVAS_H / 2);

        if (visualStyle === 'neon' || visualStyle === 'combined') {
            ctx.beginPath();
            ctx.arc(0, 0, 220 * scale, 0, 2 * Math.PI);
            ctx.strokeStyle = `rgba(255,255,255,${bass / 255})`;
            ctx.lineWidth   = 14;
            ctx.shadowBlur  = 28;
            ctx.shadowColor = '#ffffff';
            ctx.stroke();
            ctx.shadowBlur  = 0;
        }

        if (visualStyle === 'hype' || visualStyle === 'combined') {
            ctx.font         = `bold ${180 * scale}px sans-serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowBlur   = 16;
            ctx.shadowColor  = 'rgba(0,0,0,0.4)';
            ctx.fillText(currentEl, 0, 0);
            ctx.shadowBlur   = 0;
        }

        ctx.restore();

        rafId = requestAnimationFrame(renderFrame);
    }

    activeAudio.play().catch(() => {
        stopEverything();
        alert('Tap Generate Video again — browser needs a fresh tap to start audio.');
    });
    renderFrame();
});

/* ── STOP BUTTON ── */
btnStop.addEventListener('click', stopAndFinish);

function stopAndFinish() {
    isRendering = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (activeAudio) { activeAudio.pause(); activeAudio.src = ''; activeAudio = null; }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop(); /* triggers onstop → auto download */
    }
    renderStatus.textContent = 'Finalizing…';
    btnRender.disabled = false;
}
