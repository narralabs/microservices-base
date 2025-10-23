document.addEventListener('DOMContentLoaded', () => {
  const recordButton = document.querySelector('.record-button');
  const audioStatusText = document.querySelector('.audio-status-text');
  const audioVisualizerBars = document.querySelector('.audio-visualizer-bars');
  
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let audioContext = null;
  let analyser = null;
  let dataArray = null;
  let animationId = null;

  // Check if browser supports required APIs
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    audioStatusText.textContent = 'Voice recording not supported in this browser';
    recordButton.disabled = true;
    return;
  }

  // Initialize audio visualizer
  function initAudioVisualizer(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 64;
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    
    visualize();
  }

  // Visualize audio levels
  function visualize() {
    if (!isRecording) return;
    
    animationId = requestAnimationFrame(visualize);
    analyser.getByteFrequencyData(dataArray);
    
    // Update visualizer bars
    const bars = audioVisualizerBars.querySelectorAll('.visualizer-bar');
    const step = Math.floor(dataArray.length / bars.length);
    
    bars.forEach((bar, index) => {
      const value = dataArray[index * step];
      const height = (value / 255) * 100;
      bar.style.height = `${Math.max(5, height)}%`;
    });
  }

  // Stop visualizer
  function stopVisualizer() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
  }

  // Start recording
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Initialize visualizer
      initAudioVisualizer(stream);
      
      // Create media recorder
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg'
      });
      
      audioChunks = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        // Stop visualizer
        stopVisualizer();
        
        // Create audio blob
        const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        
        // Process the audio
        await processAudio(audioBlob);
      };
      
      // Start recording
      mediaRecorder.start();
      isRecording = true;
      
      // Update UI
      recordButton.classList.add('recording');
      recordButton.innerHTML = '<span class="record-icon recording-icon"></span><span>Stop Recording</span>';
      audioStatusText.textContent = 'Recording... Click to stop';
      audioVisualizerBars.classList.add('active');
      
    } catch (error) {
      console.error('Error starting recording:', error);
      audioStatusText.textContent = 'Error: Could not access microphone';
      setTimeout(() => {
        audioStatusText.textContent = 'Click microphone to start voice order';
      }, 3000);
    }
  }

  // Stop recording
  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      isRecording = false;
      mediaRecorder.stop();
      
      // Update UI
      recordButton.classList.remove('recording');
      recordButton.innerHTML = '<span class="record-icon"></span><span>Start Voice Order</span>';
      audioStatusText.textContent = 'Processing audio...';
      audioVisualizerBars.classList.remove('active');
    }
  }

  // Process recorded audio
  async function processAudio(audioBlob) {
    try {
      console.log('Processing audio blob:', {
        size: audioBlob.size,
        type: audioBlob.type
      });

      audioStatusText.textContent = 'Transcribing your order...';

      // Create form data
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      
      // Send to backend for STT
      console.log('Sending audio to /audio/stt...');
      const response = await fetch('/audio/stt', {
        method: 'POST',
        body: formData
      });

      console.log('STT response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('STT error response:', errorText);
        throw new Error(`Failed to transcribe audio: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      const transcribedText = data.text;
      
      if (!transcribedText || transcribedText.trim() === '') {
        audioStatusText.textContent = 'Could not understand audio. Please try again.';
        setTimeout(() => {
          audioStatusText.textContent = 'Click microphone to start voice order';
        }, 3000);
        return;
      }
      
      console.log('Transcribed text:', transcribedText);
      audioStatusText.textContent = `You said: "${transcribedText}"`;
      
      // Show the transcribed text in the chat as a user message
      if (window.addChatMessage) {
        window.addChatMessage(transcribedText, true);
      }
      
      // Send to chat service for processing
      audioStatusText.textContent = 'Processing your order...';
      
      if (window.sendChatMessage) {
        await window.sendChatMessage(transcribedText);
        
        // Get the last assistant message
        const messages = document.querySelectorAll('.assistant-message');
        const lastMessage = messages[messages.length - 1];
        
        if (lastMessage && lastMessage.textContent) {
          // Speak the response
          await speakText(lastMessage.textContent);
        }
        
        audioStatusText.textContent = 'Click microphone to start voice order';
      } else {
        audioStatusText.textContent = 'Chat service not available';
        setTimeout(() => {
          audioStatusText.textContent = 'Click microphone to start voice order';
        }, 3000);
      }
      
    } catch (error) {
      console.error('Error processing audio:', error);
      audioStatusText.textContent = 'Error processing audio. Please try again.';
      setTimeout(() => {
        audioStatusText.textContent = 'Click microphone to start voice order';
      }, 3000);
    }
  }

  // Text-to-Speech
  async function speakText(text) {
    try {
      // Remove any JSON parts from the response
      const cleanText = text.split('\n')[0].trim();
      
      if (!cleanText) return;
      
      console.log('Speaking:', cleanText);
      
      const response = await fetch('/audio/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: cleanText })
      });
      
      if (!response.ok) {
        throw new Error('Failed to synthesize speech');
      }
      
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
      };
      
      await audio.play();
      
    } catch (error) {
      console.error('Error speaking text:', error);
      // Non-critical error, just log it
    }
  }

  // Toggle recording
  recordButton.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  // Export speak function for use in chat
  window.speakResponse = speakText;
});

