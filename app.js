/* ═══════════════════════════════════════════════
   RHYTHM CAPTIONS — app.js
   Transcription: Deepgram API (FREE — no credit card)
   Key milegi: console.deepgram.com (free signup)
═══════════════════════════════════════════════ */

let audioUrl      = null;
let audioFile     = null;
let segments      = [];
let audioCtx      = null;
let analyser      = null;
let sourceNode    = null;
let activeAudio   = null;
let isRunning     = false;
let isRecording   = false;
let mediaRecorder = null;
let rafId         = null;

const CANVAS_W = 540;
const CANVAS_H = 960;

const canvas = document.getElementById('videoCanvas');
const ctx    = canvas.getContext('2d', { willReadFrequently: false });
canvas.width  = CANVAS_W;
canvas.height = CANVAS_H;

/* ── DOM ── */
const apiKeyInput        = document.getElementById('apiKeyInput');
const btnToggleKey       = document.getElementById('btnToggleKey');
const dropZone           = document.getElementById('dropZone');
const audioUpload        = document.getElementById('audioUpload');
const controlsCard       = document.getElementById('controlsCard');
const btnReset           = document.getElementById('btnReset');
const btnTranscribe      = document.getElementById('btnTranscribe');
const transcribeBtnLabel = document.getElementById('transcribeBtnLabel');
const lyricsBlock        = document.getElementById('lyricsPreviewBlock');
const lyricsEditor       = document.getElementById('lyricsEditor');
const lyricsHint         = document.getElementById('lyricsHint');
const previewBox         = document.getElementById('previewBox');
const renderStatus       = document.getElementById('renderStatus');
const btnPreview         = document.getElementById('btnPreview');
const btnRender          = document.getElementById('btnRender');
const btnStopPreview     = document.getElementById('btnStopPreview');
const btnStopRender      = document.getElementById('btnStopRender');
const renderDot          = document.getElementById('renderDot');

/* ── API KEY TOGGLE ── */
btnToggleKey.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

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
    audioFile = file;
    audioUrl  = URL.createObjectURL(file);
    document.getElementById('fileInfo').textContent = file.name;
    dropZone.classList.add('hidden');
    controlsCard.classList.remove('hidden');
    lyricsBlock.classList.add('hidden');
    previewBox.classList.add('hidden');
    segments = [];
});

btnReset.addEventListener('click', e => {
    e.stopPropagation();
    stopEverything();
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    audioFile = null; audioUpload.value = '';
    segments = [];
    controlsCard.classList.add('hidden');
    lyricsBlock.classList.add('hidden');
    previewBox.classList.add('hidden');
    dropZone.classList.remove('hidden');
    if (audioCtx) { audioCtx.close(); audioCtx = null; analyser = null; sourceNode = null; }
});

/* ══════════════════════════════════════
   DEEPGRAM TRANSCRIPTION (FREE TIER)
   • 200 hours free/month
   • Word-level timestamps
   • No credit card needed
   Get key: console.deepgram.com
══════════════════════════════════════ */
btnTranscribe.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) { alert('Deepgram API key daalo pehle.\nMilegi: console.deepgram.com (free signup)'); return; }
    if (!audioFile) { alert('Pehle song upload karo.'); return; }

    btnTranscribe.disabled = true;
    transcribeBtnLabel.textContent = '⏳ Transcribing…';

    try {
        /* Send audio file directly to Deepgram REST API */
        const res = await fetch(
            'https://api.deepgram.com/v1/listen?model=nova-2&language=multi&punctuate=true&words=true&utterances=false',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${key}`,
                    'Content-Type': audioFile.type || 'audio/mpeg'
                },
                body: audioFile
            }
        );

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.err_msg || err.message || `HTTP ${res.status}`);
        }

        const data = await res.json();
        const words = data?.results?.channels?.[0]?.alternatives?.[0]?.words;

        if (words && words.length > 0) {
            segments = words.map(w => ({
                word:  w.punctuated_word || w.word,
                start: w.start,
                end:   w.end
            }));
            lyricsHint.textContent = `✓ ${segments.length} words detected with timestamps.`;
        } else {
            /* Fallback: full transcript as single block */
            const text = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
            segments = [{ word: text || '(no speech detected)', start: 0, end: 9999 }];
            lyricsHint.textContent = '⚠ No word timestamps — showing full transcript.';
        }

        lyricsEditor.value = segments.map(s => s.word).join(' ');
        lyricsBlock.classList.remove('hidden');

    } catch (err) {
        alert('Transcription failed:\n' + err.message + '\n\nCheck karo key sahi hai ya nahi.\nconsole.deepgram.com pe jaake key copy karo.');
    } finally {
        btnTranscribe.disabled = false;
        transcribeBtnLabel.textContent = '✦ Detect Lyrics with AI';
    }
});

/* ══════════════════════════════════════
   AUDIO CONTEXT
══════════════════════════════════════ */
function getOrCreateAudioCtx(audioEl) {
    if (audioCtx && audioCtx.state !== 'closed') {
        if (sourceNode) { try { sourceNode.disconnect(); } catch(e) {} }
        sourceNode = audioCtx.createMediaElementSource(audioEl);
        sourceNode.connect(analyser);
        return;
    }
    audioCtx   = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 22050 });
    analyser   = audioCtx.createAnalyser();
    analyser.fftSize = 32;
    analyser.smoothingTimeConstant = 0.7;
    sourceNode = audioCtx.createMediaElementSource(audioEl);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
}

function stopEverything() {
    isRunning   = false;
    isRecording = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch(e) {}
    }
    if (activeAudio) { activeAudio.pause(); activeAudio.src = ''; activeAudio = null; }
    btnPreview.disabled = false;
    btnRender.disabled  = false;
    btnStopRender.style.display = 'none';
}

/* ══════════════════════════════════════
   CANVAS DRAW
══════════════════════════════════════ */
function drawFrame(currentTime, bass, bgType, captionStyle) {
    /* Background */
    if (bgType === 'transparent') {
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    } else if (bgType === 'black') {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    } else {
        ctx.fillStyle = '#00FF00';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    if (!segments.length) return;

    const scale    = 1 + (bass / 255) * 0.18;
    const activeSeg= segments.filter(s => currentTime >= s.start && currentTime <= s.end);
    const pastSegs  = segments.filter(s => s.end < currentTime).slice(-3);
    const nextSeg   = segments.find(s => s.start > currentTime);

    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    if (captionStyle === 'word') {
        const seg = activeSeg[0];
        if (seg) {
            const fs = Math.min(160, Math.max(80, CANVAS_W / Math.max(seg.word.length, 2) * 1.6)) * scale;
            ctx.font        = `900 ${fs}px 'Bebas Neue', sans-serif`;
            ctx.fillStyle   = '#ffffff';
            ctx.shadowBlur  = 30 * scale;
            ctx.shadowColor = 'rgba(255,255,255,0.6)';
            ctx.fillText(seg.word.toUpperCase(), CANVAS_W / 2, CANVAS_H / 2);
            ctx.shadowBlur  = 0;
        }

    } else if (captionStyle === 'line') {
        const line = activeSeg.map(s => s.word).join(' ') ||
                     pastSegs.map(s => s.word).join(' ');
        if (line) {
            const fontSize = 72 * scale;
            ctx.font        = `bold ${fontSize}px 'DM Mono', monospace`;
            ctx.fillStyle   = '#ffffff';
            ctx.shadowBlur  = 20;
            ctx.shadowColor = 'rgba(0,0,0,0.7)';
            wrapText(ctx, line, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W - 80, fontSize * 1.3);
            ctx.shadowBlur  = 0;
        }

    } else if (captionStyle === 'karaoke') {
        const allVis  = [...pastSegs.slice(-2), ...activeSeg, ...(nextSeg ? [nextSeg] : [])];
        const fontSize= 68 * scale;
        let y = CANVAS_H / 2 - (allVis.length / 2) * fontSize * 1.4;

        for (const seg of allVis) {
            const isActive = activeSeg.includes(seg);
            const isPast   = seg.end < currentTime;
            if (isActive) {
                ctx.fillStyle   = '#ffffff';
                ctx.shadowBlur  = 25 * scale;
                ctx.shadowColor = 'rgba(255,255,255,0.8)';
                ctx.font = `900 ${fontSize * 1.15}px 'Bebas Neue', sans-serif`;
            } else if (isPast) {
                ctx.fillStyle  = 'rgba(255,255,255,0.35)';
                ctx.shadowBlur = 0;
                ctx.font       = `bold ${fontSize}px 'Bebas Neue', sans-serif`;
            } else {
                ctx.fillStyle  = 'rgba(255,255,255,0.15)';
                ctx.shadowBlur = 0;
                ctx.font       = `bold ${fontSize}px 'Bebas Neue', sans-serif`;
            }
            ctx.fillText(seg.word.toUpperCase(), CANVAS_W / 2, y);
            ctx.shadowBlur = 0;
            y += fontSize * 1.45;
        }
    }

    /* Bass pulse ring */
    if (bass > 100) {
        ctx.beginPath();
        ctx.arc(CANVAS_W / 2, CANVAS_H / 2, 230 * scale, 0, 2 * Math.PI);
        ctx.strokeStyle = `rgba(255,255,255,${(bass / 255) * 0.12})`;
        ctx.lineWidth   = 8;
        ctx.stroke();
    }

    ctx.restore();
}

function wrapText(context, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    const lines = [];
    for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (context.measureText(test).width > maxWidth && line) {
            lines.push(line); line = word;
        } else { line = test; }
    }
    if (line) lines.push(line);
    const startY = y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((l, i) => context.fillText(l, x, startY + i * lineHeight));
}

/* ══════════════════════════════════════
   PREVIEW
══════════════════════════════════════ */
btnPreview.addEventListener('click', () => {
    if (!audioUrl) return;
    stopEverything();

    const bgType       = document.getElementById('bgType').value;
    const captionStyle = document.getElementById('captionStyle').value;
    const dataArr      = new Uint8Array(32);

    activeAudio = new Audio(audioUrl);
    activeAudio.crossOrigin = 'anonymous';
    getOrCreateAudioCtx(activeAudio);
    if (audioCtx.state === 'suspended') audioCtx.resume();

    isRunning = true;
    previewBox.classList.remove('hidden');
    renderStatus.textContent     = 'Previewing…';
    renderDot.style.background   = '#888';
    btnStopPreview.style.display = '';
    btnStopRender.style.display  = 'none';
    btnPreview.disabled          = true;

    activeAudio.play().catch(() => alert('Preview dobara tap karo.'));
    activeAudio.addEventListener('ended', () => {
        stopEverything();
        renderStatus.textContent = 'Preview ended.';
        btnPreview.disabled = false;
    }, { once: true });

    let fc = 0;
    function loop() {
        if (!isRunning) return;
        if (++fc % 2 === 0) { rafId = requestAnimationFrame(loop); return; }
        analyser.getByteFrequencyData(dataArr);
        drawFrame(activeAudio.currentTime, (dataArr[0]+dataArr[1])>>1, bgType, captionStyle);
        rafId = requestAnimationFrame(loop);
    }
    loop();
});

btnStopPreview.addEventListener('click', () => {
    stopEverything();
    renderStatus.textContent = 'Preview stopped.';
    btnPreview.disabled = false;
});

/* ══════════════════════════════════════
   RENDER VIDEO
══════════════════════════════════════ */
btnRender.addEventListener('click', () => {
    if (!audioUrl) return;
    stopEverything();

    const bgType       = document.getElementById('bgType').value;
    const captionStyle = document.getElementById('captionStyle').value;
    const dataArr      = new Uint8Array(32);

    activeAudio = new Audio(audioUrl);
    activeAudio.crossOrigin = 'anonymous';
    getOrCreateAudioCtx(activeAudio);
    if (audioCtx.state === 'suspended') audioCtx.resume();

    previewBox.classList.remove('hidden');
    renderStatus.textContent     = 'Recording…';
    renderDot.style.background   = '#f0f0f0';
    btnStopPreview.style.display = 'none';
    btnStopRender.style.display  = '';
    btnRender.disabled = true;
    isRunning = isRecording = true;

    const stream = canvas.captureStream(24);
    const mimes  = ['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp8','video/webm'];
    let mime = '';
    for (const m of mimes) { if (MediaRecorder.isTypeSupported(m)) { mime = m; break; } }

    let chunks = [];
    mediaRecorder = mime
        ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 800_000 })
        : new MediaRecorder(stream, { videoBitsPerSecond: 800_000 });

    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
        if (!chunks.length) return;
        const ext  = mediaRecorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
        chunks = [];
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `rhythm_captions.${ext}`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        renderStatus.textContent = '✓ Done! Check downloads.';
        renderDot.style.background = '#888';
        btnRender.disabled = false;
        btnStopRender.style.display = 'none';
    };

    mediaRecorder.start(500);
    activeAudio.play().catch(() => { stopEverything(); alert('Generate dobara tap karo.'); });
    activeAudio.addEventListener('ended', () => {
        isRunning = false;
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        renderStatus.textContent = 'Finalizing…';
    }, { once: true });

    let fc = 0;
    function loop() {
        if (!isRunning) return;
        if (++fc % 2 === 0) { rafId = requestAnimationFrame(loop); return; }
        analyser.getByteFrequencyData(dataArr);
        drawFrame(activeAudio ? activeAudio.currentTime : 0, (dataArr[0]+dataArr[1])>>1, bgType, captionStyle);
        rafId = requestAnimationFrame(loop);
    }
    loop();
});

btnStopRender.addEventListener('click', () => {
    isRunning = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (activeAudio) { activeAudio.pause(); activeAudio.src = ''; activeAudio = null; }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    renderStatus.textContent = 'Finalizing…';
    btnRender.disabled = false;
    btnStopRender.style.display = 'none';
});
