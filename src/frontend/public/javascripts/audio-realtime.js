document.addEventListener('DOMContentLoaded', async () => {
  const recordButton = document.querySelector('.record-button');
  const audioStatusText = document.querySelector('.audio-status-text');
  const audioVisualizerBars = document.querySelector('.audio-visualizer-bars');

  let socket = null;
  let mediaRecorder = null;
  let audioStream = null;
  let isRecording = false;
  let audioContext = null;
  let analyser = null;
  let dataArray = null;
  let animationId = null;
  let vadInstance = null;
  let silenceTimeout = null;
  let continuousMode = false; // Continuous listening mode
  let isProcessingResponse = false; // Flag to prevent overlapping

  // Check if browser supports required APIs
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    audioStatusText.textContent = 'Voice recording not supported in this browser';
    recordButton.disabled = true;
    return;
  }

  // Initialize Socket.IO connection
  function initSocket() {
    socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    socket.on('connect', () => {
      console.log('WebSocket connected:', socket.id);
    });

    socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
    });

    socket.on('audio-received', (data) => {
      console.log('Audio chunk acknowledged:', data);
    });

    socket.on('status', (data) => {
      console.log('Status update:', data.message);
      audioStatusText.textContent = data.message;
    });

    socket.on('transcription-complete', async (data) => {
      console.log('Transcription complete:', data);

      if (data.error) {
        audioStatusText.textContent = data.error;
        if (continuousMode) {
          setTimeout(() => {
            audioStatusText.textContent = 'Listening... Speak now';
            startRecording();
          }, 2000);
        } else {
          setTimeout(() => {
            audioStatusText.textContent = 'Click microphone to start voice order';
          }, 3000);
        }
        return;
      }

      const transcribedText = data.text;

      if (!transcribedText || transcribedText.trim() === '') {
        audioStatusText.textContent = 'Could not understand audio. Please try again.';
        if (continuousMode) {
          setTimeout(() => {
            audioStatusText.textContent = 'Listening... Speak now';
            startRecording();
          }, 2000);
        } else {
          setTimeout(() => {
            audioStatusText.textContent = 'Click microphone to start voice order';
          }, 3000);
        }
        return;
      }

      audioStatusText.textContent = `You said: "${transcribedText}"`;
      isProcessingResponse = true;

      // Show in chat
      if (window.addChatMessage) {
        window.addChatMessage(transcribedText, true);
      }

      // Send to chat service
      audioStatusText.textContent = 'Processing your order...';

      if (window.sendChatMessage) {
        await window.sendChatMessage(transcribedText);

        // Get the last assistant message
        const messages = document.querySelectorAll('.assistant-message');
        const lastMessage = messages[messages.length - 1];

        if (lastMessage && lastMessage.textContent) {
          // Request TTS for the response
          const cleanText = lastMessage.textContent.split('\n')[0].trim();
          if (cleanText) {
            socket.emit('tts-request', {
              text: cleanText,
              voice: 'af_sky'
            });
          } else {
            handleResponseComplete();
          }
        } else {
          handleResponseComplete();
        }
      } else {
        handleResponseComplete();
      }
    });

    socket.on('tts-complete', (data) => {
      console.log('TTS complete, playing audio');
      playAudioFromBase64(data.audio, data.mimeType);
      handleResponseComplete();
    });

    // Handle response completion
    function handleResponseComplete() {
      isProcessingResponse = false;

      if (continuousMode) {
        audioStatusText.textContent = 'Ready for next order... Listening';
        // Restart recording after a short delay
        setTimeout(() => {
          if (continuousMode && !isRecording) {
            startRecording();
          }
        }, 1000);
      } else {
        audioStatusText.textContent = 'Click microphone to start voice order';
      }
    }

    socket.on('error', (data) => {
      console.error('Socket error:', data);
      audioStatusText.textContent = `Error: ${data.message}`;
      setTimeout(() => {
        audioStatusText.textContent = 'Click microphone to start voice order';
      }, 3000);
    });
  }

  // Play audio from base64
  function playAudioFromBase64(base64Audio, mimeType) {
    try {
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const audioBlob = new Blob([bytes], { type: mimeType });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
      };

      audio.play().catch(err => {
        console.error('Error playing audio:', err);
      });
    } catch (error) {
      console.error('Error processing audio:', error);
    }
  }

  // Initialize audio visualizer
  function initAudioVisualizer(stream) {
    console.log('Initializing audio visualizer');
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 64;
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    console.log('Starting visualizer animation');
    visualize();
  }

  // Visualize audio levels
  function visualize() {
    // Don't check isRecording here - let it run as long as animationId is active
    // This allows it to continue in continuous mode

    animationId = requestAnimationFrame(visualize);

    if (!analyser || !dataArray) {
      console.warn('Analyser or dataArray not initialized');
      return;
    }

    analyser.getByteFrequencyData(dataArray);

    // Update visualizer bars
    const bars = audioVisualizerBars.querySelectorAll('.visualizer-bar');
    if (bars.length === 0) {
      console.warn('No visualizer bars found');
      return;
    }

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
    // Don't close audio context in continuous mode - we'll reuse it
    if (audioContext && audioContext.state !== 'closed' && !continuousMode) {
      audioContext.close();
      audioContext = null;
      analyser = null;
      dataArray = null;
    }
  }

  // Simple Voice Activity Detection (without external library)
  function setupSimpleVAD(stream) {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    const vadAnalyser = audioContext.createAnalyser();
    const vadSource = audioContext.createMediaStreamSource(stream);
    vadSource.connect(vadAnalyser);
    vadAnalyser.fftSize = 2048;

    const bufferLength = vadAnalyser.frequencyBinCount;
    const vadDataArray = new Uint8Array(bufferLength);

    const SILENCE_THRESHOLD = 30; // Adjust based on testing
    const SILENCE_DURATION = 2000; // 2 seconds of silence to stop
    let silenceStart = null;

    function checkVAD() {
      if (!isRecording) return;

      vadAnalyser.getByteTimeDomainData(vadDataArray);

      // Calculate average volume
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const value = Math.abs(vadDataArray[i] - 128);
        sum += value;
      }
      const average = sum / bufferLength;

      if (average < SILENCE_THRESHOLD) {
        // Silence detected
        if (silenceStart === null) {
          silenceStart = Date.now();
        } else if (Date.now() - silenceStart > SILENCE_DURATION) {
          console.log('Silence detected for', SILENCE_DURATION, 'ms, stopping recording');
          stopRecording();
          return;
        }
      } else {
        // Sound detected, reset silence timer
        silenceStart = null;
      }

      setTimeout(checkVAD, 100); // Check every 100ms
    }

    // Start VAD checking after a short delay (to avoid immediate stops)
    setTimeout(() => {
      if (isRecording) {
        checkVAD();
      }
    }, 1000);
  }

  // Start recording
  async function startRecording() {
    try {
      // Initialize socket if not already connected
      if (!socket || !socket.connected) {
        initSocket();
        // Wait a bit for connection
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Get new audio stream only if we don't have one already (continuous mode reuses stream)
      if (!audioStream) {
        audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 16000
          }
        });
      }

      // Initialize visualizer only if not already initialized
      if (!analyser || !audioContext || audioContext.state === 'closed') {
        console.log('Creating new audio visualizer');
        initAudioVisualizer(audioStream);
      } else {
        // Resume visualization if analyser exists
        console.log('Resuming existing visualizer');
        if (!animationId) {
          visualize();
        }
      }

      // Setup simple VAD
      setupSimpleVAD(audioStream);

      // Create new media recorder for each recording session
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      mediaRecorder = new MediaRecorder(audioStream, { mimeType });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socket && socket.connected) {
          // Convert blob to array buffer and send via WebSocket
          event.data.arrayBuffer().then(buffer => {
            socket.emit('audio-stream', buffer);
          });
        }
      };

      mediaRecorder.onstop = () => {
        console.log('Recording stopped, sending audio-end event');

        // Only pause visualizer, don't stop it in continuous mode
        if (!continuousMode) {
          stopVisualizer();
        } else {
          // In continuous mode, just cancel the animation frame but keep the context
          if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
          }
        }

        if (socket && socket.connected) {
          socket.emit('audio-end');
        }

        // Stop all tracks only if not in continuous mode
        if (audioStream && !continuousMode) {
          audioStream.getTracks().forEach(track => track.stop());
          audioStream = null;
        }
      };

      // Start recording with time slices (send chunks every 250ms)
      mediaRecorder.start(250);
      isRecording = true;

      // Update UI
      recordButton.classList.add('recording');
      if (continuousMode) {
        recordButton.innerHTML = '<span class="record-icon recording-icon"></span><span>Stop Conversation</span>';
      } else {
        recordButton.innerHTML = '<span class="record-icon recording-icon"></span><span>Recording... (auto-stops on silence)</span>';
      }
      audioStatusText.textContent = 'Listening... Speak now';
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

      // Clear any silence timeout
      if (silenceTimeout) {
        clearTimeout(silenceTimeout);
        silenceTimeout = null;
      }
    }
  }

  // Stop continuous mode
  function stopContinuousMode() {
    continuousMode = false;
    isProcessingResponse = false;

    // Stop current recording if active
    if (isRecording) {
      stopRecording();
    }

    // Stop audio stream
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
      audioStream = null;
    }

    // Stop visualizer completely (now we can close the context)
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close();
      audioContext = null;
      analyser = null;
      dataArray = null;
    }

    // Update UI
    recordButton.classList.remove('recording', 'continuous-mode');
    recordButton.innerHTML = '<span class="record-icon"></span><span>Start Voice Order</span>';
    audioStatusText.textContent = 'Click microphone to start voice order';
    audioVisualizerBars.classList.remove('active');
  }

  // Toggle recording
  recordButton.addEventListener('click', () => {
    if (continuousMode) {
      // Stop continuous mode
      stopContinuousMode();
    } else if (isRecording) {
      // Single shot mode - stop recording
      stopRecording();
    } else {
      // Start continuous mode
      continuousMode = true;
      recordButton.classList.add('continuous-mode');
      startRecording();
    }
  });

  // Initialize socket on page load
  initSocket();
});

