let audioCtx, analyser, source, audioBuffer;
let audioUrl = null;
let wordsArray = [];
const canvas = document.getElementById('videoCanvas');
const ctx = canvas.getContext('2d');

// File Upload Trigger Logic
const dropZone = document.getElementById('dropZone');
const audioUpload = document.getElementById('audioUpload');
dropZone.addEventListener('click', () => audioUpload.click());

audioUpload.addEventListener('change', handleFile);

function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    document.getElementById('fileInfo').innerText = file.name;
    document.getElementById('controlsCard').classList.remove('hidden');
    audioUrl = URL.createObjectURL(file);
}

// Rhythm visualizer processing setup
document.getElementById('btnPlay').addEventListener('click', () => {
    if(!audioUrl) return;
    let audio = new Audio(audioUrl);
    audio.play();
    
    // Default mock behavior for synchronization visual test
    setupAudioAnalysis(audio);
});

function setupAudioAnalysis(audioNode) {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        source = audioCtx.createMediaElementSource(audioNode);
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        analyser.fftSize = 64;
    }
}

// Main Video Generator Logic
document.getElementById('btnRender').addEventListener('click', () => {
    const rawText = document.getElementById('captionText').value;
    if(!rawText) {
        alert("Please write some captions first!");
        return;
    }
    wordsArray = rawText.split(',').map(item => item.trim());
    generateVideoOutput();
});

function generateVideoOutput() {
    const bgType = document.getElementById('bgType').value;
    const stream = canvas.captureStream(30); // 30 FPS Video
    
    // Check format based on background requirements
    const mimeType = bgType === 'transparent' ? 'video/webm;codecs=vp9' : 'video/mp4;codecs=h264';
    let mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
    let chunks = [];

    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = bgType === 'transparent' ? 'rhythm_captions.webm' : 'rhythm_captions.mp4';
        a.click();
    };

    mediaRecorder.start();
    
    let currentWordIndex = 0;
    let frameCount = 0;

    function drawFrame() {
        // Clear frame or apply Chroma key
        if (bgType === 'transparent') {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        } else {
            ctx.fillStyle = '#00FF00'; // Pure Chroma Green Screen
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // Kinetic text parameters
        ctx.fillStyle = '#2A0800'; // Dark Theme typography
        ctx.font = 'bold 90px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        let currentWord = wordsArray[currentWordIndex] || "";
        
        // Simulating text jumping or scale change dynamically based on rhythm frame pacing
        let scaleFactor = 1 + Math.sin(frameCount * 0.4) * 0.1; 
        
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(scaleFactor, scaleFactor);
        ctx.fillText(currentWord, 0, 0);
        ctx.restore();

        frameCount++;
        
        // Every 25 frames change the word automatically (or map it via audio frequencies dynamically)
        if(frameCount % 25 === 0) {
            currentWordIndex++;
        }

        if (currentWordIndex < wordsArray.length) {
            requestAnimationFrame(drawFrame);
        } else {
            mediaRecorder.stop();
        }
    }

    drawFrame();
}
