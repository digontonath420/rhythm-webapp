let audioUrl = null;
let wordsArray = [];
const canvas = document.getElementById('videoCanvas');
const ctx = canvas.getContext('2d');

const dropZone = document.getElementById('dropZone');
const audioUpload = document.getElementById('audioUpload');
const btnReset = document.getElementById('btnReset');
const controlsCard = document.getElementById('controlsCard');
const previewBox = document.getElementById('previewBox');

// Dynamic Trigger Click
dropZone.addEventListener('click', () => audioUpload.click());

audioUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    document.getElementById('fileInfo').innerText = file.name;
    dropZone.classList.add('hidden');
    controlsCard.classList.remove('hidden');
    audioUrl = URL.createObjectURL(file);
});

// Cross/Cancel Configuration Logic
btnReset.addEventListener('click', (e) => {
    e.stopPropagation(); 
    resetAppEngine();
});

function resetAppEngine() {
    audioUpload.value = '';
    audioUrl = null;
    controlsCard.classList.add('hidden');
    previewBox.classList.add('hidden');
    dropZone.classList.remove('hidden');
}

// Media Flow Engine
document.getElementById('btnPlay').addEventListener('click', () => {
    if(!audioUrl) return;
    let audio = new Audio(audioUrl);
    audio.play();
});

document.getElementById('btnRender').addEventListener('click', () => {
    const rawText = document.getElementById('captionText').value;
    if(!rawText) {
        alert("Bhai pehle captions toh daal de!");
        return;
    }
    wordsArray = rawText.split(',').map(item => item.trim());
    previewBox.classList.remove('hidden');
    renderKineticVideo();
});

function renderKineticVideo() {
    const bgType = document.getElementById('bgType').value;
    const stream = canvas.captureStream(30); 
    const mimeType = bgType === 'transparent' ? 'video/webm;codecs=vp9' : 'video/mp4;codecs=h264';
    
    let mediaRecorder;
    try {
        mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
    } catch (err) {
        mediaRecorder = new MediaRecorder(stream); // Phone processing fallback
    }
    
    let chunks = [];
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = bgType === 'transparent' ? 'rhythm_captions.webm' : 'rhythm_captions.mp4';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        previewBox.classList.add('hidden');
    };

    mediaRecorder.start();
    let currentWordIndex = 0;
    let frameCount = 0;

    function draw() {
        if (bgType === 'transparent') {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        } else {
            ctx.fillStyle = '#00FF00'; // Pure Green Chromakey
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        ctx.fillStyle = '#2A0800'; 
        ctx.font = 'bold 110px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        let currentWord = wordsArray[currentWordIndex] || "";
        let pulse = 1 + Math.sin(frameCount * 0.4) * 0.08; 
        
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(pulse, pulse);
        ctx.fillText(currentWord, 0, 0);
        ctx.strokeStyle = '#F4DBD8';
        ctx.lineWidth = 4;
        ctx.strokeText(currentWord, 0, 0);
        ctx.restore();

        frameCount++;
        if(frameCount % 24 === 0) currentWordIndex++; 

        if (currentWordIndex < wordsArray.length) {
            requestAnimationFrame(draw);
        } else {
            mediaRecorder.stop();
        }
    }
    draw();
}
