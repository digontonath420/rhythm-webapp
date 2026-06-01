/* ═══════════════════════════════════════════════
   RHYTHM CAPTIONS — app.js
   Transcription: Deepgram whisper-large
   Fix: Audio chunking (45s) + center-channel vocal boost
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
const progressWrap       = document.getElementById('progressWrap');
const progressBar        = document.getElementById('progressBar');
const progressLabel      = document.getElementById('progressLabel');

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

/* ══════════════════════════════════════════════════
   WAV ENCODER
   AudioBuffer → WAV Blob (mono 16-bit PCM)
══════════════════════════════════════════════════ */
function audioBufferToWavBlob(monoSamples, sampleRate) {
    const dataLen = monoSamples.length * 2;
    const buf     = new ArrayBuffer(44 + dataLen);
    const view    = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    ws(0,  'RIFF'); view.setUint32(4,  36 + dataLen, true);
    ws(8,  'WAVE'); ws(12, 'fmt ');
    view.setUint32(16, 16,         true);
    view.setUint16(20, 1,          true); // PCM
    view.setUint16(22, 1,          true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2,          true);
    view.setUint16(34, 16,         true);
    ws(36, 'data'); view.setUint32(40, dataLen, true);
    let off = 44;
    for (let i = 0; i < monoSamples.length; i++) {
        const s = Math.max(-1, Math.min(1, monoSamples[i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        off += 2;
    }
    return new Blob([buf], { type: 'audio/wav' });
}

/* ══════════════════════════════════════════════════
   VOCAL BOOST — center channel extraction
   In most songs, vocals are center-panned (L+R)/2
   This suppresses hard-panned instruments
══════════════════════════════════════════════════ */
function extractCenter(audioBuffer) {
    const L = audioBuffer.getChannelData(0);
    const R = audioBuffer.numberOfChannels > 1
              ? audioBuffer.getChannelData(1)
              : audioBuffer.getChannelData(0);
    const out = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) {
        out[i] = (L[i] + R[i]) * 0.5; // center = vocals
    }
    return out;
}

/* ══════════════════════════════════════════════════
   CHUNK + TRANSCRIBE
   Splits audio into 45s chunks, sends each to
   Deepgram, merges results with offset timestamps
══════════════════════════════════════════════════ */
async function transcribeFullSong(file, apiKey, lang, useVocalBoost) {
    setProgress(0, 'Decoding audio…');

    // Decode audio
    const arrBuf = await file.arrayBuffer();
    const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await tempCtx.decodeAudioData(arrBuf);
    await tempCtx.close();

    const sampleRate   = decoded.sampleRate;
    const CHUNK_SEC    = 45;
    const CHUNK_SAMPS  = CHUNK_SEC * sampleRate;
    const totalSamples = decoded.length;

    // Get mono samples (with vocal boost if enabled)
    let monoFull;
    if (useVocalBoost) {
        setProgress(5, 'Boosting vocals…');
        monoFull = extractCenter(decoded);
    } else {
        const L = decoded.getChannelData(0);
        const R = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : L;
        monoFull = new Float32Array(L.length);
        for (let i = 0; i < L.length; i++) monoFull[i] = (L[i] + R[i]) * 0.5;
    }

    // Split into chunks
    const numChunks = Math.ceil(totalSamples / CHUNK_SAMPS);
    let allWords    = [];

    for (let c = 0; c < numChunks; c++) {
        const startSamp  = c * CHUNK_SAMPS;
        const endSamp    = Math.min(startSamp + CHUNK_SAMPS, totalSamples);
        const chunkMono  = monoFull.slice(startSamp, endSamp);
        const offsetSec  = startSamp / sampleRate;

        const pct = 10 + Math.round((c / numChunks) * 85);
        setProgress(pct, `Transcribing chunk ${c + 1} of ${numChunks}…`);

        const wavBlob = audioBufferToWavBlob(chunkMono, sampleRate);

        try {
            const res = await fetch(
                `https://api.deepgram.com/v1/listen?model=whisper-large&language=${lang}&punctuate=true&words=true`,
                {
                    method:  'POST',
                    headers: {
                        'Authorization': `Token ${apiKey}`,
                        'Content-Type':  'audio/wav'
                    },
                    body: wavBlob
                }
            );

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.err_msg || `Chunk ${c+1}: HTTP ${res.status}`);
            }

            const data  = await res.json();
            const words = data?.results?.channels?.[0]?.alternatives?.[0]?.words || [];

            // Offset timestamps by chunk start
            for (const w of words) {
                allWords.push({
                    word:  w.punctuated_word || w.word || '',
                    start: (w.start || 0) + offsetSec,
                    end:   (w.end   || 0) + offsetSec
                });
            }
        } catch (chunkErr) {
            console.warn('Chunk error:', chunkErr.message);
            // Continue with remaining chunks even if one fails
        }
    }

    setProgress(100, '✓ Done!');
    return allWords;
}

function setProgress(pct, label) {
    progressWrap.style.display = 'block';
    progressBar.style.width    = pct + '%';
    progressLabel.textContent  = label;
    if (pct >= 100) {
        setTimeout(() => { progressWrap.style.display = 'none'; }, 1500);
    }
}

/* ══════════════════════════════════════
   TRANSCRIBE BUTTON
══════════════════════════════════════ */
btnTranscribe.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key)      { alert('Deepgram API key daalo.\nMilegi: console.deepgram.com (free signup)'); return; }
    if (!audioFile){ alert('Pehle song upload karo.'); return; }

    btnTranscribe.disabled = true;
    transcribeBtnLabel.textContent = '⏳ Transcribing…';
    segments = [];
    lyricsBlock.classList.add('hidden');

    try {
        const lang          = document.getElementById('songLang')?.value  || 'hi';
        const useVocalBoost = document.getElementById('vocalBoost')?.checked ?? true;

        const words = await transcribeFullSong(audioFile, key, lang, useVocalBoost);

        if (words.length > 0) {
            segments = words.filter(w => w.word.trim() !== '');
            lyricsHint.textContent = `✓ ${segments.length} words detected across full song.`;
        } else {
            segments = [{ word: '(no speech detected)', start: 0, end: 9999 }];
            lyricsHint.textContent = '⚠ No words found. Try toggling Vocal Boost or changing language.';
        }

        lyricsEditor.value = segments.map(s => s.word).join(' ');
        lyricsBlock.classList.remove('hidden');

    } catch (err) {
        progressWrap.style.display = 'none';
        alert('Transcription failed:\n' + err.message);
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
    isRunning = isRecording = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') { try { mediaRecorder.stop(); } catch(e){} }
    if (activeAudio) { activeAudio.pause(); activeAudio.src = ''; activeAudio = null; }
    btnPreview.disabled = false;
    btnRender.disabled  = false;
    btnStopRender.style.display = 'none';
}

/* ══════════════════════════════════════
   CANVAS DRAW — 5 styles
══════════════════════════════════════ */
let bounceOffset  = 0;
let typeProgress  = 0;
let lastTypedSeg  = null;
let glitchTimer   = 0;

function drawFrame(currentTime, bass, bgType, captionStyle) {
    /* Background */
    if      (bgType === 'transparent') ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    else if (bgType === 'black')       { ctx.fillStyle = '#000'; ctx.fillRect(0,0,CANVAS_W,CANVAS_H); }
    else                               { ctx.fillStyle = '#00FF00'; ctx.fillRect(0,0,CANVAS_W,CANVAS_H); }

    if (!segments.length) return;

    const pulse    = 1 + (bass / 255) * 0.22;
    const activeSeg= segments.filter(s => currentTime >= s.start && currentTime <= s.end);
    const pastSegs  = segments.filter(s => s.end < currentTime).slice(-4);
    const nextSeg   = segments.find(s => s.start > currentTime);

    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    /* ── 1. WORD POP ── */
    if (captionStyle === 'word') {
        const seg = activeSeg[0];
        if (seg) {
            const fs = Math.min(160, Math.max(70, CANVAS_W / Math.max(seg.word.length, 2) * 1.5)) * pulse;
            ctx.font        = `900 ${fs}px 'Bebas Neue', sans-serif`;
            ctx.fillStyle   = '#ffffff';
            ctx.shadowBlur  = 35 * pulse;
            ctx.shadowColor = 'rgba(255,255,255,0.7)';
            ctx.fillText(seg.word.toUpperCase(), CANVAS_W/2, CANVAS_H/2);
            ctx.shadowBlur  = 0;
        }

    /* ── 2. LINE FADE ── */
    } else if (captionStyle === 'line') {
        const line = activeSeg.map(s => s.word).join(' ') || pastSegs.map(s=>s.word).join(' ');
        if (line) {
            const fs = 68 * pulse;
            ctx.font        = `bold ${fs}px 'DM Mono', monospace`;
            ctx.fillStyle   = '#ffffff';
            ctx.shadowBlur  = 18; ctx.shadowColor = 'rgba(0,0,0,0.8)';
            wrapText(ctx, line, CANVAS_W/2, CANVAS_H/2, CANVAS_W-80, fs*1.35);
            ctx.shadowBlur  = 0;
        }

    /* ── 3. KARAOKE ── */
    } else if (captionStyle === 'karaoke') {
        const allVis  = [...pastSegs.slice(-2), ...activeSeg, ...(nextSeg?[nextSeg]:[])];
        const fs      = 65 * pulse;
        let y = CANVAS_H/2 - (allVis.length/2) * fs * 1.45;
        for (const seg of allVis) {
            const isAct = activeSeg.includes(seg);
            const isPast= seg.end < currentTime;
            ctx.shadowBlur = 0;
            if (isAct) {
                ctx.fillStyle   = '#ffffff';
                ctx.shadowBlur  = 28*pulse; ctx.shadowColor='rgba(255,255,255,0.9)';
                ctx.font        = `900 ${fs*1.18}px 'Bebas Neue', sans-serif`;
            } else if (isPast) {
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.font      = `bold ${fs}px 'Bebas Neue', sans-serif`;
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.12)';
                ctx.font      = `bold ${fs}px 'Bebas Neue', sans-serif`;
            }
            ctx.fillText(seg.word.toUpperCase(), CANVAS_W/2, y);
            ctx.shadowBlur = 0;
            y += fs * 1.5;
        }

    /* ── 4. BOUNCE ── */
    } else if (captionStyle === 'bounce') {
        const seg = activeSeg[0];
        if (seg) {
            bounceOffset = -Math.abs(Math.sin(Date.now() / 120)) * 30 * pulse;
            const fs = Math.min(150, Math.max(65, CANVAS_W / Math.max(seg.word.length,2) * 1.4)) * pulse;
            /* shadow / behind layer */
            ctx.font      = `900 ${fs}px 'Bebas Neue', sans-serif`;
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.fillText(seg.word.toUpperCase(), CANVAS_W/2, CANVAS_H/2 + 12);
            /* main word */
            ctx.fillStyle   = '#ffffff';
            ctx.shadowBlur  = 22*pulse; ctx.shadowColor='rgba(255,255,255,0.5)';
            ctx.fillText(seg.word.toUpperCase(), CANVAS_W/2, CANVAS_H/2 + bounceOffset);
            ctx.shadowBlur  = 0;
        }
        /* show next word dimly */
        if (nextSeg) {
            const fs2 = 40;
            ctx.font      = `bold ${fs2}px 'Bebas Neue', sans-serif`;
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.fillText(nextSeg.word.toUpperCase(), CANVAS_W/2, CANVAS_H/2 + 130);
        }

    /* ── 5. TYPEWRITER ── */
    } else if (captionStyle === 'typewriter') {
        const seg = activeSeg[0];
        if (seg) {
            if (seg !== lastTypedSeg) { typeProgress = 0; lastTypedSeg = seg; }
            typeProgress = Math.min(seg.word.length, typeProgress + 0.35 * pulse);
            const display = seg.word.slice(0, Math.floor(typeProgress)).toUpperCase();
            const cursor  = Math.floor(Date.now()/400)%2 === 0 ? '|' : '';
            const fs      = Math.min(160, Math.max(70, CANVAS_W / Math.max(seg.word.length,2)*1.5));
            ctx.font        = `900 ${fs}px 'Bebas Neue', sans-serif`;
            ctx.fillStyle   = '#ffffff';
            ctx.shadowBlur  = 20; ctx.shadowColor='rgba(255,255,255,0.5)';
            ctx.fillText(display + cursor, CANVAS_W/2, CANVAS_H/2);
            ctx.shadowBlur  = 0;
        }
    }

    /* subtle bass ring */
    if (bass > 90) {
        ctx.beginPath();
        ctx.arc(CANVAS_W/2, CANVAS_H/2, 230*pulse, 0, 2*Math.PI);
        ctx.strokeStyle = `rgba(255,255,255,${(bass/255)*0.1})`;
        ctx.lineWidth   = 7;
        ctx.stroke();
    }

    ctx.restore();
}

function wrapText(context, text, x, y, maxWidth, lineH) {
    const words = text.split(' ');
    let line = '', lines = [];
    for (const w of words) {
        const t = line ? line+' '+w : w;
        if (context.measureText(t).width > maxWidth && line) { lines.push(line); line=w; }
        else line = t;
    }
    if (line) lines.push(line);
    const sy = y - ((lines.length-1)*lineH)/2;
    lines.forEach((l,i) => context.fillText(l, x, sy + i*lineH));
}

/* ══════════════════════════════════════
   PREVIEW
══════════════════════════════════════ */
function startLoop(bgType, captionStyle) {
    const dataArr = new Uint8Array(32);
    let fc = 0;
    function loop() {
        if (!isRunning) return;
        if (++fc % 2 === 0) { rafId = requestAnimationFrame(loop); return; }
        analyser.getByteFrequencyData(dataArr);
        drawFrame(activeAudio ? activeAudio.currentTime : 0, (dataArr[0]+dataArr[1])>>1, bgType, captionStyle);
        rafId = requestAnimationFrame(loop);
    }
    loop();
}

btnPreview.addEventListener('click', () => {
    if (!audioUrl) return;
    stopEverything();
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

    const bgType       = document.getElementById('bgType').value;
    const captionStyle = document.getElementById('captionStyle').value;

    activeAudio.play().catch(()=>alert('Preview dobara tap karo.'));
    activeAudio.addEventListener('ended', ()=>{ stopEverything(); renderStatus.textContent='Preview ended.'; btnPreview.disabled=false; }, {once:true});
    startLoop(bgType, captionStyle);
});

btnStopPreview.addEventListener('click', ()=>{
    stopEverything();
    renderStatus.textContent='Preview stopped.';
    btnPreview.disabled=false;
});

/* ══════════════════════════════════════
   RENDER VIDEO
══════════════════════════════════════ */
btnRender.addEventListener('click', () => {
    if (!audioUrl) return;
    stopEverything();
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

    const bgType       = document.getElementById('bgType').value;
    const captionStyle = document.getElementById('captionStyle').value;

    const stream = canvas.captureStream(24);
    const mimes  = ['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp8','video/webm'];
    let mime = '';
    for (const m of mimes) { if (MediaRecorder.isTypeSupported(m)) { mime=m; break; } }

    let chunks = [];
    mediaRecorder = mime
        ? new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond:800_000})
        : new MediaRecorder(stream, {videoBitsPerSecond:800_000});

    mediaRecorder.ondataavailable = e => { if(e.data.size>0) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
        if (!chunks.length) return;
        const ext  = mediaRecorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, {type:mediaRecorder.mimeType});
        chunks = [];
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href=url; a.download=`rhythm_captions.${ext}`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(()=>URL.revokeObjectURL(url),10000);
        renderStatus.textContent = '✓ Done! Check downloads.';
        renderDot.style.background = '#888';
        btnRender.disabled = false;
        btnStopRender.style.display = 'none';
    };

    mediaRecorder.start(500);
    activeAudio.play().catch(()=>{ stopEverything(); alert('Generate dobara tap karo.'); });
    activeAudio.addEventListener('ended',()=>{
        isRunning=false;
        if(mediaRecorder&&mediaRecorder.state!=='inactive') mediaRecorder.stop();
        renderStatus.textContent='Finalizing…';
    },{once:true});
    startLoop(bgType, captionStyle);
});

btnStopRender.addEventListener('click', ()=>{
    isRunning=false;
    if(rafId){cancelAnimationFrame(rafId);rafId=null;}
    if(activeAudio){activeAudio.pause();activeAudio.src='';activeAudio=null;}
    if(mediaRecorder&&mediaRecorder.state!=='inactive') mediaRecorder.stop();
    renderStatus.textContent='Finalizing…';
    btnRender.disabled=false;
    btnStopRender.style.display='none';
});
