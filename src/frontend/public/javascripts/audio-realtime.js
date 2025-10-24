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
  let currentAudio = null; // Track currently playing audio
  let recordedChunks = []; // Store audio chunks for complete blob

  // Check if browser supports required APIs
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    audioStatusText.textContent = 'Voice recording not supported in this browser';
    recordButton.disabled = true;
    return;
  }

  // Handle response completion (called after TTS audio finishes playing)
  function handleResponseComplete() {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] handleResponseComplete called, continuousMode:`, continuousMode, 'isRecording:', isRecording);
    isProcessingResponse = false;

    if (continuousMode) {
      audioStatusText.textContent = 'Your turn - Listening...';
      // Restart recording after a short delay (ding will play when startRecording is called)
      console.log(`[${timestamp}] Scheduling recording restart in 500ms`);
      setTimeout(() => {
        const timestamp2 = new Date().toISOString();
        console.log(`[${timestamp2}] Timeout fired, continuousMode:`, continuousMode, 'isRecording:', isRecording);
        if (continuousMode && !isRecording) {
          console.log(`[${timestamp2}] Restarting recording...`);
          startRecording();
        }
      }, 500);
    } else {
      audioStatusText.textContent = 'Click microphone to start voice order';
    }
  }

  // Initialize Socket.IO connection (connects to frontend server)
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

      // Stop recording immediately when we start processing
      if (isRecording && continuousMode) {
        console.log('Stopping recording to process response');
        stopRecording();
      }

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
        // Send the message - the chat will emit an event when complete
        window.sendChatMessage(transcribedText);
      } else {
        handleResponseComplete();
      }
    });

    socket.on('tts-complete', async (data) => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] TTS complete, playing audio`);
      audioStatusText.textContent = 'Assistant speaking...';
      // Update button text when assistant is speaking
      if (continuousMode) {
        recordButton.innerHTML = '<span class="record-icon"></span><span>Stop Conversation</span>';
      }
      await playAudioFromBase64(data.audio, data.mimeType);
    });

    socket.on('error', (data) => {
      console.error('Socket error:', data);
      audioStatusText.textContent = `Error: ${data.message}`;
      setTimeout(() => {
        audioStatusText.textContent = 'Click microphone to start voice order';
      }, 3000);
    });
  }

  // Play a ding sound to indicate user's turn
  function playDingSound() {
    try {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] Playing ding sound...`);
      // Create a simple ding sound using Web Audio API
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      // Set frequency for a pleasant ding (E note)
      oscillator.frequency.value = 659.25;
      oscillator.type = 'sine';

      // Envelope for the ding
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.3);

      // Clean up
      setTimeout(() => {
        audioCtx.close();
      }, 500);
    } catch (error) {
      console.error('Error playing ding sound:', error);
    }
  }

  // Play audio from base64
  async function playAudioFromBase64(base64Audio, mimeType) {
    try {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] playAudioFromBase64 called, audio length:`, base64Audio.length, 'mimeType:', mimeType);

      // Stop any currently playing audio
      if (currentAudio) {
        console.log('Stopping currently playing audio');
        currentAudio.pause();
        currentAudio = null;
      }

      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Safari compatibility: try multiple MIME types
      let audioBlob;
      if (mimeType === 'audio/wav') {
        // Try with explicit WAV MIME type first
        audioBlob = new Blob([bytes], { type: 'audio/wav' });
        console.log('Created WAV blob');
      } else {
        audioBlob = new Blob([bytes], { type: mimeType });
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      console.log('Created audio blob, size:', audioBlob.size, 'URL:', audioUrl);

      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = audioUrl;
      currentAudio = audio;

      audio.onloadedmetadata = () => {
        console.log('Audio metadata loaded, duration:', audio.duration);
      };

      audio.onended = () => {
        console.log('Audio playback ended');
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        // Call handleResponseComplete when audio finishes
        handleResponseComplete();
      };

      audio.onerror = (err) => {
        console.error('Error playing audio:', err, audio.error);
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        // Don't call handleResponseComplete - let the play() catch handler deal with it
      };

      console.log('Starting audio playback...');

      // Try Web Audio API first for better Safari compatibility
      try {
        const webAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await audioBlob.arrayBuffer();
        console.log('Decoding audio data with Web Audio API...');
        const audioBuffer = await webAudioCtx.decodeAudioData(arrayBuffer);
        console.log('Audio decoded, duration:', audioBuffer.duration, 'seconds');
        
        const source = webAudioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(webAudioCtx.destination);

        let hasEnded = false;
        
        source.onended = () => {
          if (hasEnded) return;
          hasEnded = true;
          const ts = new Date().toISOString();
          console.log(`[${ts}] Web Audio API playback ended`);
          URL.revokeObjectURL(audioUrl);
          currentAudio = null;
          webAudioCtx.close();
          handleResponseComplete();
        };
        
        // Backup timeout
        const durationMs = audioBuffer.duration * 1000;
        setTimeout(() => {
          if (!hasEnded) {
            hasEnded = true;
            const ts = new Date().toISOString();
            console.log(`[${ts}] Web Audio API playback ended via timeout`);
            URL.revokeObjectURL(audioUrl);
            currentAudio = null;
            webAudioCtx.close();
            handleResponseComplete();
          }
        }, durationMs + 100);
        
        source.start(0);
        const ts = new Date().toISOString();
        console.log(`[${ts}] Web Audio API playback started, duration:`, durationMs, 'ms');
        return; // Success!
      } catch (webAudioErr) {
        console.error('Web Audio API failed, falling back to HTML5 Audio:', webAudioErr);
      }
      
      // Fallback to HTML5 Audio
      audio.volume = 1.0;
      audio.load();
      
      audio.play().then(() => {
        console.log('Audio playback started successfully');
      }).catch(async (err) => {
        console.error('Error starting audio playback:', err);
        console.error('Error name:', err.name);
        console.error('Error message:', err.message);

        // If format not supported, try Web Audio API
        if (err.name === 'NotSupportedError') {
          console.log('Trying Web Audio API as fallback...');
          try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const arrayBuffer = await audioBlob.arrayBuffer();
            console.log('Decoding audio data...');
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            console.log('Audio decoded, duration:', audioBuffer.duration, 'seconds');

            const source = audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioCtx.destination);
            
            let hasEnded = false;
            
            source.onended = () => {
              if (hasEnded) return; // Prevent double-firing
              hasEnded = true;
              const ts = new Date().toISOString();
              console.log(`[${ts}] Web Audio API playback ended via onended`);
              URL.revokeObjectURL(audioUrl);
              currentAudio = null;
              audioCtx.close();
              handleResponseComplete();
            };
            
            // Backup: use setTimeout based on duration
            const durationMs = audioBuffer.duration * 1000;
            const startTime = new Date().toISOString();
            setTimeout(() => {
              if (!hasEnded) {
                hasEnded = true;
                const ts = new Date().toISOString();
                console.log(`[${ts}] Web Audio API playback ended via timeout`);
                URL.revokeObjectURL(audioUrl);
                currentAudio = null;
                audioCtx.close();
                handleResponseComplete();
              }
            }, durationMs + 100); // Add 100ms buffer
            
            source.start(0);
            console.log(`[${startTime}] Web Audio API playback started, will end in`, durationMs, 'ms');
            return; // Success, don't call handleResponseComplete yet
          } catch (webAudioErr) {
            console.error('Web Audio API also failed:', webAudioErr);
          }
        }

        // If autoplay was blocked, try to play with user interaction
        if (err.name === 'NotAllowedError') {
          console.error('Autoplay was blocked by browser. Audio playback requires user interaction.');
          audioStatusText.textContent = 'Click here to hear response';
          
          // Create a one-time click handler on the status text (not the whole document)
          const playOnClick = (e) => {
            e.stopPropagation(); // Prevent event from bubbling to record button
            audio.play().then(() => {
              console.log('Audio playback started after user interaction');
              audioStatusText.textContent = 'Assistant speaking...';
              // Don't remove listener yet, let onended handle completion
            }).catch(e => {
              console.error('Still failed to play:', e);
              // If it still fails, clean up and continue
              URL.revokeObjectURL(audioUrl);
              currentAudio = null;
              handleResponseComplete();
            });
          };
          audioStatusText.addEventListener('click', playOnClick, { once: true });
          audioStatusText.style.cursor = 'pointer';
          audioStatusText.style.textDecoration = 'underline';
          return; // Don't call handleResponseComplete yet, wait for user click
        }
        
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        // Only call handleResponseComplete for other errors
        handleResponseComplete();
      });
    } catch (error) {
      console.error('Error processing audio:', error);
      currentAudio = null;
      // Still call handleResponseComplete on error
      handleResponseComplete();
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

    const SILENCE_THRESHOLD = 5; // Much lower threshold - more sensitive to actual speech
    const SILENCE_DURATION = 1500; // 1.5 seconds of silence to stop
    const MIN_RECORDING_DURATION = 500; // Minimum 0.5 seconds before checking for silence
    let silenceStart = null;
    let recordingStartTime = Date.now();

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
      
      // Log volume for debugging
      if (Math.random() < 0.1) { // Log 10% of the time to avoid spam
        console.log('Audio level:', average.toFixed(2));
      }

      // Don't check for silence until minimum recording duration has passed
      const recordingDuration = Date.now() - recordingStartTime;
      if (recordingDuration < MIN_RECORDING_DURATION) {
        setTimeout(checkVAD, 100);
        return;
      }

      if (average < SILENCE_THRESHOLD) {
        // Silence detected
        if (silenceStart === null) {
          silenceStart = Date.now();
          console.log('Silence started');
        } else if (Date.now() - silenceStart > SILENCE_DURATION) {
          console.log('Silence detected for', SILENCE_DURATION, 'ms, stopping recording');
          stopRecording();
          return;
        }
      } else {
        // Sound detected, reset silence timer
        if (silenceStart !== null) {
          console.log('Sound detected, resetting silence timer');
        }
        silenceStart = null;
      }

      setTimeout(checkVAD, 100); // Check every 100ms
    }

    // Reset recording start time
    recordingStartTime = Date.now();
    
    // Start VAD checking after a short delay (to avoid immediate stops)
    setTimeout(() => {
      if (isRecording) {
        checkVAD();
      }
    }, 500);
  }

  // Start recording
  async function startRecording() {
    try {
      // Play ding sound to indicate it's the user's turn to speak
      playDingSound();

      // Initialize socket if not already connected
      if (!socket || !socket.connected) {
        await initSocket();
        // Wait a bit for connection
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Get new audio stream only if we don't have one already (continuous mode reuses stream)
      if (!audioStream) {
        console.log('Requesting microphone access...');
        audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,  // Higher quality
            channelCount: 1
          }
        });
        console.log('Microphone access granted');
        console.log('Audio stream tracks:', audioStream.getAudioTracks());
        console.log('Audio track settings:', audioStream.getAudioTracks()[0]?.getSettings());
        
        // Test if the track is actually active
        const track = audioStream.getAudioTracks()[0];
        if (track) {
          console.log('Track state:', track.readyState);
          console.log('Track enabled:', track.enabled);
          console.log('Track muted:', track.muted);
        }
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
      // Try to use opus codec which is better supported
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        mimeType = 'audio/ogg;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
      } else {
        mimeType = 'audio/ogg';
      }
      console.log('Using mimeType:', mimeType);
      mediaRecorder = new MediaRecorder(audioStream, { 
        mimeType: mimeType,
        audioBitsPerSecond: 128000  // 128 kbps for better quality
      });

      // Clear previous chunks
      recordedChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          // Store chunks locally instead of sending immediately
          recordedChunks.push(event.data);
          console.log('Recorded chunk:', event.data.size, 'bytes, total chunks:', recordedChunks.length);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log('Recording stopped, processing', recordedChunks.length, 'chunks');

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

        // Create a complete blob from all chunks
        if (recordedChunks.length > 0 && socket && socket.connected) {
          const audioBlob = new Blob(recordedChunks, { type: mimeType });
          console.log('Created audio blob:', audioBlob.size, 'bytes, type:', audioBlob.type);
          console.log('Chunks collected:', recordedChunks.length);
          console.log('Individual chunk sizes:', recordedChunks.map(c => c.size));
          
          // Send the complete audio blob
          const arrayBuffer = await audioBlob.arrayBuffer();
          console.log('Sending arrayBuffer size:', arrayBuffer.byteLength);
          socket.emit('audio-complete', {
            audio: arrayBuffer,
            mimeType: mimeType
          });
          
          // Clear chunks
          recordedChunks = [];
        } else {
          console.error('No chunks recorded or socket not connected!');
        }

        // Stop all tracks only if not in continuous mode
        if (audioStream && !continuousMode) {
          audioStream.getTracks().forEach(track => track.stop());
          audioStream = null;
        }
      };

      // Start recording with timeslices to ensure we get chunks
      mediaRecorder.start(100); // Request chunks every 100ms
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

    // Stop any currently playing audio
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

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
    // Unlock audio playback on first interaction (Safari requirement)
    if (!audioContext || audioContext.state === 'closed') {
      const unlockAudio = new (window.AudioContext || window.webkitAudioContext)();
      const silentSource = unlockAudio.createBufferSource();
      silentSource.buffer = unlockAudio.createBuffer(1, 1, 22050);
      silentSource.connect(unlockAudio.destination);
      silentSource.start(0);
      console.log('Audio unlocked for autoplay');
    }
    
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

  // Listen for chat response completion to trigger TTS
  window.addEventListener('chat-response-complete', (event) => {
    if (!isProcessingResponse) return; // Only process if we're in voice mode

    const timestamp = new Date().toISOString();
    const responseText = event.detail.text;
    console.log(`[${timestamp}] Chat response complete, requesting TTS for:`, responseText);

    if (responseText && responseText.trim()) {
      socket.emit('tts-request', {
        text: responseText,
        voice: 'af_sky'
      });
      console.log(`[${timestamp}] TTS request sent`);
    } else {
      // No text to speak, just complete the response
      console.log(`[${timestamp}] No text to speak, completing response`);
      handleResponseComplete();
    }
  });

  // Initialize socket on page load
  initSocket();
});

