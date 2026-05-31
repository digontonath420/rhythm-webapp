let audioUrl = null;
let audioCtx = null;
let analyser = null;
let audioSource = null;
let activeAudio = null;
let isRendering = false;

const canvas = document.getElementById('videoCanvas');
const ctx = canvas.getContext('2d');

const dropZone = document.getElementById('dropZone');
const audioUpload = document.getElementById('audioUpload');
const btnReset = document.getElementById('btnReset');
const controlsCard = document.getElementById('controlsCard');
const previewBox = document.getElementById('previewBox');

// Trend items sequence for rhythm detection drops
const hypeElements = ["🔥", "⚡", "👑", "💎", "✨", "🎵", "💥", "🚀"];
let currentElement = "🔥";
let lastBeatTime = 0;

dropZone.addEventListener('click', () => audioUpload.click());

audioUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    document.getElementById('fileInfo').innerText = file.name;
    dropZone.classList.add('hidden');
    controlsCard.classList.remove('hidden');
    
    stopAllAudio();
    audioUrl = URL.createObjectURL(file);
});

btnReset.addEventListener('click', (e) => {
    e.stopPropagation();
    resetApp();
});

function stopAllAudio() {
    if (activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
        activeAudio = null;
    }
    isRendering = false;
}

function resetApp() {
    stopAllAudio();
    audioUpload.value = '';
    audioUrl = null;
    controlsCard.classList.add('hidden');
    previewBox.classList.add('hidden');
    dropZone.classList.remove('hidden');
}

// Audio context analyzer init
function initAudioAnalyzer(audioElement) {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        audioSource = audioCtx.createMediaElementSource(audioElement);
        audioSource.connect(analyser);
        analyser.connect(audioCtx.destination);
        analyser.fftSize = 64; // Low bin size for fast bass tracking
    }
}

document.getElementById('btnPlay').addEventListener('click', () => {
    if (!audioUrl) return;
    stopAllAudio();

    activeAudio = new Audio(audioUrl);
    initAudioAnalyzer(activeAudio);
    
    activeAudio.play().catch(() => alert("Tap again to play audio track."));
});

document.getElementById('btnRender').addEventListener('click', () => {
    if (!audioUrl) return;
    stopAllAudio();

    activeAudio = new Audio(audioUrl);
    initAudioAnalyzer(activeAudio);
    
    previewBox.classList.remove('hidden');
    isRendering = true;
    
    activeAudio.play();
    startVideoPipeline();
});

function startVideoPipeline() {
    const bgType = document.getElementById('bgType').value;
    const visualStyle = document.getElementById('visualStyle').value;
    
    const stream = canvas.captureStream(30);
    let mediaRecorder;
    
    try {
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/mp4;codecs=h264' });
    } catch(e) {
        mediaRecorder = new MediaRecorder(stream); // Phone native fallback 
    }
    
    let chunks = [];
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = bgType === 'green' ? 'rhythm_beat.mp4' : 'rhythm_beat.webm';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        previewBox.classList.add('hidden');
    };

    mediaRecorder.start();
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function renderFrame() {
        if (!isRendering || activeAudio.ended) {
            mediaRecorder.stop();
            stopAllAudio();
            return;
        }

        // Frequency Data capture
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate average sub-bass energy (First 4 frequency bands)
        let bassEnergy = 0;
        for (let i = 0; i < 4; i++) {
            bassEnergy += dataArray[i];
        }
        bassEnergy = bassEnergy / 4; 

        // Background config
        if (bgType === 'transparent') {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        } else {
            ctx.fillStyle = '#00FF00'; // Standard mobile green screen setup
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        const now = performance.now();
        // Beat detection logic threshold
        if (bassEnergy > 190 && (now - lastBeatTime > 300)) {
            const randomIndex = Math.floor(Math.random() * hypeElements.length);
            currentElement = hypeElements[randomIndex];
            lastBeatTime = now;
        }

        // Visual Scale multiplier driven by live bass energy intensity
        let dynamicScale = 1 + (bassEnergy / 255) * 0.4;

        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);

        if (visualStyle === 'neon' || visualStyle === 'combined') {
            // Neon pulse ring vector rendering
            ctx.beginPath();
            ctx.arc(0, 0, 180 * dynamicScale, 0, 2 * Math.PI);
            ctx.strokeStyle = `rgba(244, 219, 216, ${bassEnergy / 255})`;
            ctx.lineWidth = 15;
            ctx.shadowBlur = 30;
            ctx.shadowColor = '#C09891';
            ctx.stroke();
        }

        if (visualStyle === 'hype' || visualStyle === 'combined') {
            // Kinetic Text Element rendering
            ctx.font = `bold ${160 * dynamicScale}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowBlur = 20;
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.fillText(currentElement, 0, 0);
        }

        ctx.restore();

        if (isRendering) {
            requestAnimationFrame(renderFrame);
        }
    }

    renderFrame();
}
