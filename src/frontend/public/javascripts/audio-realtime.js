document.addEventListener('DOMContentLoaded', async () => {
  const recordButton = document.querySelector('.record-button');
  const audioStatusText = document.querySelector('.audio-status-text'); // May not exist in v2 design
  const audioVisualizerBars = document.querySelector('.audio-visualizer-bars'); // May not exist in v2 design
  
  // Voice UI buttons
  const speakToAgentButton = document.getElementById('speakToAgentButton');
  const agentListeningButton = document.getElementById('agentListeningButton');
  const agentSpeakingButton = document.getElementById('agentSpeakingButton');
  const agentProcessingButton = document.getElementById('agentProcessingButton');
  const stopVoiceButton = document.getElementById('stopVoiceButton');
  const audioWaveVisualizer = document.getElementById('audioWaveVisualizer');

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
  let maxDurationTimeout = null; // Maximum recording duration timeout
  let continuousMode = false; // Continuous listening mode
  let isProcessingResponse = false; // Flag to prevent overlapping
  let currentAudio = null; // Track currently playing audio
  let recordedChunks = []; // Store audio chunks for complete blob
  let maxAudioLevel = 0; // Track maximum audio level during recording
  let silenceStart = null; // Track when silence started (for VAD)
  let speakingAnimationId = null; // Animation ID for speaking mode waves

  // Check if browser supports required APIs
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (audioStatusText) {
      audioStatusText.textContent = 'Voice recording not supported in this browser';
    }
    if (recordButton) {
      recordButton.disabled = true;
    }
    if (speakToAgentButton) {
      speakToAgentButton.disabled = true;
    }
    return;
  }

  // Function to update voice button visibility
  function updateVoiceButtons(state) {
    if (!speakToAgentButton || !agentListeningButton || !agentSpeakingButton || !agentProcessingButton || !stopVoiceButton) return;
    
    // Hide all buttons first
    speakToAgentButton.style.display = 'none';
    agentListeningButton.style.display = 'none';
    agentSpeakingButton.style.display = 'none';
    agentProcessingButton.style.display = 'none';
    stopVoiceButton.style.display = 'none';
    
    // Show/hide audio visualizer
    if (audioWaveVisualizer) {
      if (state === 'listening' || state === 'speaking') {
        audioWaveVisualizer.style.display = 'flex';
        // Start speaking animation if in speaking mode
        if (state === 'speaking') {
          startSpeakingWaveAnimation();
        } else {
          stopSpeakingWaveAnimation();
        }
      } else {
        audioWaveVisualizer.style.display = 'none';
        stopSpeakingWaveAnimation();
      }
    }
    
    // Show the appropriate button based on state
    switch(state) {
      case 'idle':
        speakToAgentButton.style.display = 'flex';
        break;
      case 'listening':
        agentListeningButton.style.display = 'flex';
        stopVoiceButton.style.display = 'flex'; // Show stop button when listening
        break;
      case 'speaking':
        agentSpeakingButton.style.display = 'flex';
        stopVoiceButton.style.display = 'flex'; // Show stop button when speaking
        break;
      case 'processing':
        agentProcessingButton.style.display = 'flex';
        stopVoiceButton.style.display = 'flex'; // Show stop button when processing
        break;
    }
  }

  // Handle response completion (called after TTS audio finishes playing)
  function handleResponseComplete() {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] handleResponseComplete called, continuousMode:`, continuousMode, 'isRecording:', isRecording);
    isProcessingResponse = false;

    if (continuousMode) {
      // In continuous mode, we'll restart listening, so don't reset to idle yet
      if (audioStatusText) {
        audioStatusText.textContent = 'Your turn - Listening...';
      }
      // Restart recording after a short delay (ding will play when startRecording is called)
      console.log(`[${timestamp}] Scheduling recording restart in 500ms`);
      setTimeout(() => {
        const timestamp2 = new Date().toISOString();
        console.log(`[${timestamp2}] Timeout fired, continuousMode:`, continuousMode, 'isRecording:', isRecording);
        if (continuousMode && !isRecording) {
          console.log(`[${timestamp2}] Restarting recording...`);
          startRecording(); // This will update buttons to 'listening'
        }
      }, 500);
    } else {
      // Not in continuous mode, reset to idle
      updateVoiceButtons('idle');
      if (audioStatusText) {
        audioStatusText.textContent = 'Click microphone to start voice order';
      }
    }
  }

  // Initialize Socket.IO connection (connects to frontend server)
  function initSocket() {
    return new Promise((resolve, reject) => {
      if (socket && socket.connected) {
        console.log('Socket already connected:', socket.id);
        resolve();
        return;
      }

      socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
      });

      socket.on('connect', () => {
        console.log('WebSocket connected:', socket.id);
        resolve();
      });

      socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        reject(error);
      });

      socket.on('disconnect', () => {
        console.log('WebSocket disconnected');
      });

      socket.on('audio-received', (data) => {
        console.log('Audio chunk acknowledged:', data);
      });

      socket.on('status', (data) => {
        console.log('Status update from server:', data.message);
        // Update UI to show we're actively transcribing
        updateVoiceButtons('processing');
        // Stop waves if they're still showing
        if (animationId) {
          cancelAnimationFrame(animationId);
          animationId = null;
        }
        if (audioWaveVisualizer) {
          audioWaveVisualizer.style.display = 'none';
        }
        if (audioVisualizerBars) {
          audioVisualizerBars.classList.remove('active');
        }
        if (audioStatusText) {
          audioStatusText.textContent = data.message || 'Transcribing audio...';
        }
      });

      socket.on('transcription-complete', async (data) => {
        console.log('Transcription complete:', data);

        // Stop recording immediately when we start processing
        if (isRecording && continuousMode) {
          console.log('Stopping recording to process response');
          stopRecording();
        }

        if (data.error) {
          if (audioStatusText) {
            audioStatusText.textContent = data.error;
          }
          if (continuousMode) {
            setTimeout(() => {
              if (audioStatusText) {
                audioStatusText.textContent = 'Listening... Speak now';
              }
              startRecording();
            }, 2000);
          } else {
            setTimeout(() => {
              if (audioStatusText) {
                audioStatusText.textContent = 'Click microphone to start voice order';
              }
            }, 3000);
          }
          return;
        }

        const transcribedText = data.text;

        if (!transcribedText || transcribedText.trim() === '') {
          if (audioStatusText) {
            audioStatusText.textContent = 'Could not understand audio. Please try again.';
          }
          if (continuousMode) {
            setTimeout(() => {
              if (audioStatusText) {
                audioStatusText.textContent = 'Listening... Speak now';
              }
              startRecording();
            }, 2000);
          } else {
            setTimeout(() => {
              if (audioStatusText) {
                audioStatusText.textContent = 'Click microphone to start voice order';
              }
            }, 3000);
          }
          return;
        }

        if (audioStatusText) {
          audioStatusText.textContent = `You said: "${transcribedText}"`;
        }
        isProcessingResponse = true;
        
        // Show processing state if in continuous mode, otherwise show idle
        if (continuousMode) {
          updateVoiceButtons('processing'); // Show "Processing..." button in continuous mode
        } else {
          updateVoiceButtons('idle'); // Show "Speak to Agent" button if not in continuous mode
        }

        // Show transcribed text in chat FIRST with typing animation for "live" feel
        // Then start LLM streaming after transcription is displayed
        if (window.typeMessage) {
          // Use typing animation to show transcription as it appears (fast speed for "live" feel)
          await window.typeMessage(transcribedText, true, 25);
        } else if (window.addChatMessage) {
          // Fallback to instant display if typeMessage not available
          window.addChatMessage(transcribedText, true);
        }

        // Update status
        if (audioStatusText) {
          audioStatusText.textContent = 'Processing your order...';
        }

        // Now start LLM streaming AFTER transcription is displayed
        if (window.sendChatMessage) {
          // Send the message - the chat will stream the response
          window.sendChatMessage(transcribedText);
        } else {
          handleResponseComplete();
        }
      });

      socket.on('tts-complete', async (data) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] TTS complete, playing audio`);
        if (audioStatusText) {
          audioStatusText.textContent = 'Assistant speaking...';
        }
        updateVoiceButtons('speaking'); // Show "Agent is Speaking" button
        // Update button text when assistant is speaking
        if (continuousMode && recordButton) {
          recordButton.innerHTML = '<span class="record-icon"></span><span>Stop Conversation</span>';
        }
        await playAudioFromBase64(data.audio, data.mimeType);
      });

      socket.on('error', (data) => {
        console.error('Socket error:', data);
        if (audioStatusText) {
          audioStatusText.textContent = `Error: ${data.message}`;
        }
        updateVoiceButtons('idle');
        setTimeout(() => {
          if (audioStatusText) {
            audioStatusText.textContent = 'Click microphone to start voice order';
          }
        }, 3000);
      });
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

    // Start visualization - will use wave visualizer if bars don't exist
    console.log('Starting visualizer animation');
    visualize();
  }

  // Visualize audio levels
  function visualize() {
    const frameStartTime = performance.now();
    
    // Check if we should stop immediately (if recording stopped or processing)
    if (!isRecording) {
      // Stop animation immediately
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
      return;
    }

    // Schedule next frame AFTER checking if we should continue
    animationId = requestAnimationFrame(visualize);

    if (!analyser || !dataArray) {
      console.warn('[VISUALIZE] Analyser or dataArray not initialized');
      return;
    }

    analyser.getByteFrequencyData(dataArray);
    
    // Calculate current audio level for immediate detection
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const currentLevel = sum / dataArray.length;
    
    // IMMEDIATE silence detection in visualizer - stop waves instantly when silence detected
    // This runs every frame (~60fps) for instant response
    // BUT: Only stop waves if we've actually detected speech (maxAudioLevel > threshold)
    // This prevents stopping waves due to background noise before user speaks
    if (isRecording && silenceStart !== null && maxAudioLevel >= 20) {
      const silenceDuration = Date.now() - silenceStart;
      // We're in silence AFTER speech - stop waves immediately
      if (audioWaveVisualizer && audioWaveVisualizer.style.display !== 'none') {
        const stopTime = performance.now();
        console.log(`[VISUALIZER ${stopTime.toFixed(2)}ms] ⚡ SILENCE DETECTED IN VISUALIZER - Stopping waves. Silence duration: ${silenceDuration}ms, Current level: ${currentLevel.toFixed(2)}, maxAudioLevel: ${maxAudioLevel.toFixed(2)}`);
        audioWaveVisualizer.style.display = 'none';
        if (audioStatusText) {
          audioStatusText.textContent = 'Transcribing audio...';
        }
        updateVoiceButtons('processing');
      }
      if (audioVisualizerBars && audioVisualizerBars.classList.contains('active')) {
        audioVisualizerBars.classList.remove('active');
      }
      // Don't update waves when in silence - return early
      return;
    }
    
    // Still speaking - continue animating waves
    // ALWAYS update wave visualizer if it's visible (for listening mode)
    if (audioWaveVisualizer) {
      const displayStyle = window.getComputedStyle(audioWaveVisualizer).display;
      if (displayStyle !== 'none') {
        updateWaveVisualizer();
      } else {
        // Log why we're not updating (less frequently)
        if (Math.random() < 0.02) { // Log 2% of the time
          console.log('[VISUALIZE] Wave visualizer hidden, display:', displayStyle);
        }
      }
    } else {
      if (Math.random() < 0.02) { // Log 2% of the time
        console.log('[VISUALIZE] No wave visualizer element found!');
      }
    }
    
    // Also update visualizer bars if they exist (legacy support)
    if (audioVisualizerBars) {
      const bars = audioVisualizerBars.querySelectorAll('.visualizer-bar');
      if (bars.length > 0) {
        const step = Math.floor(dataArray.length / bars.length);
        bars.forEach((bar, index) => {
          const value = dataArray[index * step];
          const height = (value / 255) * 100;
          bar.style.height = `${Math.max(5, height)}%`;
        });
      }
    }
  }

  // Update wave visualizer with real-time audio data
  function updateWaveVisualizer() {
    if (!audioWaveVisualizer || !analyser || !dataArray) {
      console.log('[WAVE_VIZ] Skipping update - missing components:', {
        hasVisualizer: !!audioWaveVisualizer,
        hasAnalyser: !!analyser,
        hasDataArray: !!dataArray
      });
      return;
    }
    
    const displayStyle = window.getComputedStyle(audioWaveVisualizer).display;
    if (displayStyle === 'none') {
      console.log('[WAVE_VIZ] Skipping update - visualizer is hidden (computed display:', displayStyle, ')');
      return; // Don't update if hidden
    }
    
    analyser.getByteFrequencyData(dataArray);
    
    const waveBars = audioWaveVisualizer.querySelectorAll('.wave-bar');
    if (waveBars.length === 0) {
      console.log('[WAVE_VIZ] No wave bars found! Visualizer element:', audioWaveVisualizer);
      return;
    }
    
    // Calculate overall volume to detect if there's actual voice input
    let totalVolume = 0;
    for (let i = 0; i < dataArray.length; i++) {
      totalVolume += dataArray[i];
    }
    const averageVolume = totalVolume / dataArray.length;
    
    // Threshold for detecting voice (adjust as needed)
    const VOICE_THRESHOLD = 5; // Minimum volume to show movement
    
    // Log audio levels periodically for debugging (more frequent initially)
    if (Math.random() < 0.15) { // Log 15% of the time
      console.log('[WAVE_VIZ] Audio levels:', {
        averageVolume: averageVolume.toFixed(2),
        maxLevel: Math.max(...Array.from(dataArray)).toFixed(2),
        threshold: VOICE_THRESHOLD,
        isRecording: isRecording,
        waveBarsCount: waveBars.length,
        visualizerDisplay: displayStyle,
        aboveThreshold: averageVolume > VOICE_THRESHOLD
      });
    }
    
    // Calculate average volume for each bar
    const step = Math.floor(dataArray.length / waveBars.length);
    
    waveBars.forEach((bar, index) => {
      const startIdx = index * step;
      const endIdx = Math.min(startIdx + step, dataArray.length);
      
      // Calculate average for this bar's frequency range
      let sum = 0;
      for (let i = startIdx; i < endIdx; i++) {
        sum += dataArray[i];
      }
      const barAverage = sum / (endIdx - startIdx);
      
      // Only show movement if there's actual voice input
      if (averageVolume > VOICE_THRESHOLD) {
        // Map to height (8px to 32px) based on actual audio
        const height = 8 + (barAverage / 255) * 24;
        bar.style.height = `${Math.max(8, Math.min(32, height))}px`;
        
        // Adjust opacity based on volume
        const opacity = 0.4 + (barAverage / 255) * 0.6;
        bar.style.opacity = opacity;
      } else {
        // No voice detected - show minimal/idle state
        bar.style.height = '8px';
        bar.style.opacity = 0.3;
      }
    });
  }

  // Start speaking wave animation (when agent is speaking)
  function startSpeakingWaveAnimation() {
    if (!audioWaveVisualizer || speakingAnimationId) return; // Already animating
    
    const waveBars = audioWaveVisualizer.querySelectorAll('.wave-bar');
    if (waveBars.length === 0) return;
    
    let frame = 0;
    
    function animate() {
      if (!audioWaveVisualizer || audioWaveVisualizer.style.display === 'none') {
        stopSpeakingWaveAnimation();
        return;
      }
      
      waveBars.forEach((bar, index) => {
        // Create a wave pattern using sine wave
        // Each bar has a different phase offset for a wave effect
        const phase = (frame * 0.1) + (index * 0.5);
        const wave = Math.sin(phase);
        // Map wave from -1 to 1 to height from 8px to 32px
        const height = 8 + (wave + 1) * 12; // 8px base + up to 24px variation
        bar.style.height = `${height}px`;
        
        // Adjust opacity based on wave position
        const opacity = 0.5 + (wave + 1) * 0.25; // 0.5 to 1.0
        bar.style.opacity = opacity;
      });
      
      frame++;
      speakingAnimationId = requestAnimationFrame(animate);
    }
    
    animate();
  }
  
  // Stop speaking wave animation
  function stopSpeakingWaveAnimation() {
    if (speakingAnimationId) {
      cancelAnimationFrame(speakingAnimationId);
      speakingAnimationId = null;
    }
    
    // Reset wave bars to default state
    if (audioWaveVisualizer) {
      const waveBars = audioWaveVisualizer.querySelectorAll('.wave-bar');
      waveBars.forEach((bar) => {
        bar.style.height = '8px';
        bar.style.opacity = '0.3';
      });
    }
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

    const SILENCE_THRESHOLD = 12; // Increased threshold - levels 14-24 after speech should be considered silence
    const SILENCE_DURATION = 800; // 0.8 seconds of silence to stop (faster response - immediate processing)
    const MIN_RECORDING_DURATION = 300; // Minimum 0.3 seconds before checking for silence
    const MAX_RECORDING_DURATION = 10000; // Maximum 10 seconds - force stop even if silence not detected
    // silenceStart is now declared at top level so visualizer can access it
    let recordingStartTime = Date.now();
    let maxDurationTimeout = null;

    function checkVAD() {
      const vadCheckStart = performance.now();
      if (!isRecording) return;

      // Use both frequency and time-domain data for better speech detection
      vadAnalyser.getByteFrequencyData(vadDataArray);
      
      // Also get time-domain data for more accurate volume detection
      const timeDataArray = new Uint8Array(bufferLength);
      vadAnalyser.getByteTimeDomainData(timeDataArray);

      // Calculate average volume from frequency data (more accurate for speech)
      let freqSum = 0;
      for (let i = 0; i < bufferLength; i++) {
        freqSum += vadDataArray[i];
      }
      const freqAverage = freqSum / bufferLength;
      
      // Calculate RMS from time-domain data (better for overall volume)
      let timeSumSquares = 0;
      for (let i = 0; i < bufferLength; i++) {
        const normalized = (timeDataArray[i] - 128) / 128;
        timeSumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(timeSumSquares / bufferLength);
      const timeDomainLevel = rms * 255; // Scale to 0-255 range
      
      // Use the higher of the two measurements to catch quiet voices better
      const average = Math.max(freqAverage, timeDomainLevel);

      // Focus on speech frequency ranges (human voice: 85-255 Hz fundamental, but harmonics extend higher)
      // Check frequencies in the speech range (roughly bins 0-50 for 48kHz sample rate with 2048 FFT)
      let speechRangeSum = 0;
      const speechRangeEnd = Math.min(50, bufferLength);
      for (let i = 0; i < speechRangeEnd; i++) {
        speechRangeSum += vadDataArray[i];
      }
      const speechRangeAverage = speechRangeSum / speechRangeEnd;
      
      // Use the maximum of all measurements to catch quiet voices - this is more sensitive
      // This ensures we don't miss quiet speech that might be in one frequency range but not others
      const combinedLevel = Math.max(average, speechRangeAverage, timeDomainLevel);
      
      // Track maximum audio level for quality check (use combined level)
      if (combinedLevel > maxAudioLevel) {
        maxAudioLevel = combinedLevel;
      }
      
      // Log volume for debugging (more frequent for troubleshooting)
      if (Math.random() < 0.3) { // Log 30% of the time for better debugging
        console.log('VAD: combinedLevel:', combinedLevel.toFixed(2), 'maxAudioLevel:', maxAudioLevel.toFixed(2), 'freqAvg:', freqAverage.toFixed(2), 'timeDomain:', timeDomainLevel.toFixed(2), 'speechRange:', speechRangeAverage.toFixed(2), 'hasSpeech:', (maxAudioLevel >= 6));
      }

      // Don't check for silence until minimum recording duration has passed
      const recordingDuration = Date.now() - recordingStartTime;
      if (recordingDuration < MIN_RECORDING_DURATION) {
        setTimeout(checkVAD, 100);
        return;
      }
      
      // Force stop if recording has been going too long (fallback safety)
      if (recordingDuration > MAX_RECORDING_DURATION) {
        console.log('Maximum recording duration reached (', MAX_RECORDING_DURATION, 'ms), forcing stop. maxAudioLevel:', maxAudioLevel.toFixed(2));
        stopRecording();
        return;
      }

      // Only stop on silence if we've detected meaningful speech first
      // This prevents stopping when user hasn't spoken yet
      // Need a higher threshold to distinguish real speech from background noise
      const SPEECH_DETECTED_THRESHOLD = 20; // Higher threshold to avoid false positives from background noise (was 6)
      const hasDetectedSpeech = maxAudioLevel >= SPEECH_DETECTED_THRESHOLD;

      // Use relative silence threshold: if we detected speech, use 20% of peak as silence threshold
      // This handles residual noise/echo after speech better
      // IMPORTANT: Only use relative threshold AFTER speech has been detected, otherwise use base threshold
      const relativeSilenceThreshold = hasDetectedSpeech && maxAudioLevel > SPEECH_DETECTED_THRESHOLD
        ? Math.max(SILENCE_THRESHOLD, maxAudioLevel * 0.2) 
        : SILENCE_THRESHOLD;
      
      if (combinedLevel < relativeSilenceThreshold) {
        // Silence detected
        const silenceDetectTime = performance.now();
        console.log(`[VAD ${silenceDetectTime.toFixed(2)}ms] SILENCE DETECTED - Level: ${combinedLevel.toFixed(2)} < ${relativeSilenceThreshold.toFixed(2)} (threshold: ${SILENCE_THRESHOLD}, relative: ${relativeSilenceThreshold.toFixed(2)}, peak: ${maxAudioLevel.toFixed(2)}), hasDetectedSpeech: ${hasDetectedSpeech}, silenceStart: ${silenceStart}`);
        
        // CRITICAL: Only set silenceStart if we've actually detected speech first
        // This prevents false silence detection from background noise
        if (hasDetectedSpeech) {
          // Only check for silence-based stop if we've already detected speech
          if (silenceStart === null) {
            const silenceStartTime = performance.now();
            silenceStart = Date.now();
            console.log(`[VAD ${silenceStartTime.toFixed(2)}ms] ⚡ SILENCE STARTED - Setting silenceStart timestamp. maxAudioLevel: ${maxAudioLevel.toFixed(2)}, combinedLevel: ${combinedLevel.toFixed(2)}`);
            // Visualizer will handle stopping waves immediately (runs at 60fps)
            updateVoiceButtons('processing');
            if (audioStatusText) {
              audioStatusText.textContent = 'Transcribing audio...';
            }
          } else {
            const silenceDuration = Date.now() - silenceStart;
            const stopCheckTime = performance.now();
            if (silenceDuration > SILENCE_DURATION) {
              console.log(`[VAD ${stopCheckTime.toFixed(2)}ms] ⚡⚡⚡ STOPPING RECORDING - Silence duration: ${silenceDuration}ms > ${SILENCE_DURATION}ms, maxAudioLevel: ${maxAudioLevel.toFixed(2)}`);
              
              // IMMEDIATELY stop waves and visualizer BEFORE calling stopRecording
              const stopWavesTime = performance.now();
              if (animationId) {
                cancelAnimationFrame(animationId);
                animationId = null;
                console.log(`[VAD ${stopWavesTime.toFixed(2)}ms] Cancelled animation frame`);
              }
              if (audioWaveVisualizer) {
                audioWaveVisualizer.style.display = 'none';
                console.log(`[VAD ${stopWavesTime.toFixed(2)}ms] Hid wave visualizer`);
              }
              if (audioVisualizerBars) {
                audioVisualizerBars.classList.remove('active');
              }
              
              // Update UI immediately to show we're processing
              const uiUpdateTime = performance.now();
              updateVoiceButtons('processing');
              if (audioStatusText) {
                audioStatusText.textContent = 'Transcribing audio...';
              }
              console.log(`[VAD ${uiUpdateTime.toFixed(2)}ms] Updated UI to processing state`);
              
              // Now stop recording
              const stopRecTime = performance.now();
              stopRecording();
              console.log(`[VAD ${stopRecTime.toFixed(2)}ms] Called stopRecording() - Total VAD check time: ${(stopRecTime - vadCheckStart).toFixed(2)}ms`);
              return;
            } else {
              // Show "Transcribing..." when approaching silence threshold (last 300ms) for early feedback
              const remaining = SILENCE_DURATION - silenceDuration;
              if (remaining < 300) {
                // Stop waves early when we're about to stop
                if (animationId) {
                  cancelAnimationFrame(animationId);
                  animationId = null;
                }
                if (audioWaveVisualizer) {
                  audioWaveVisualizer.style.display = 'none';
                }
                if (audioVisualizerBars) {
                  audioVisualizerBars.classList.remove('active');
                }
                
                if (audioStatusText) {
                  audioStatusText.textContent = 'Transcribing audio...';
                }
                // Also update button state early for immediate visual feedback
                updateVoiceButtons('processing');
              }
              // Log progress towards silence threshold
              if (Math.random() < 0.1) {
                console.log('Silence continuing,', silenceDuration, 'ms /', SILENCE_DURATION, 'ms');
              }
            }
          }
        } else {
          // No speech detected yet - keep listening, don't stop on silence
          // But log if we've been waiting a while
          const waitTime = Date.now() - recordingStartTime;
          if (waitTime > 3000 && Math.random() < 0.1) {
            console.log('Still waiting for speech, maxAudioLevel:', maxAudioLevel.toFixed(2), 'threshold:', SPEECH_DETECTED_THRESHOLD, 'waitTime:', waitTime, 'ms');
          }
          silenceStart = null; // Reset silence timer since we're still waiting for speech
        }
      } else {
        // Sound detected, reset silence timer
        if (silenceStart !== null) {
          const soundDetectTime = performance.now();
          console.log(`[VAD ${soundDetectTime.toFixed(2)}ms] 🔊 SOUND DETECTED - Level: ${combinedLevel.toFixed(2)} >= ${SILENCE_THRESHOLD}, resetting silence timer`);
        }
        silenceStart = null;
      }

      const vadCheckEnd = performance.now();
      const vadCheckDuration = vadCheckEnd - vadCheckStart;
      if (vadCheckDuration > 5) { // Log if VAD check takes more than 5ms
        console.log(`[VAD ${vadCheckEnd.toFixed(2)}ms] VAD check took ${vadCheckDuration.toFixed(2)}ms`);
      }
      
      setTimeout(checkVAD, 50); // Check every 50ms for faster response
    }

    // Reset recording start time and silence tracking
    recordingStartTime = Date.now();
    silenceStart = null; // Reset silence tracking for new recording
    // Reset maxAudioLevel for new recording - we want fresh detection
    // This prevents false silence detection from previous recording's peak
    const oldMaxAudioLevel = maxAudioLevel;
    maxAudioLevel = 0;
    console.log(`[VAD] Starting new recording - reset maxAudioLevel from ${oldMaxAudioLevel.toFixed(2)} to 0`);
    
    // Set maximum duration timeout as fallback safety
    if (maxDurationTimeout) {
      clearTimeout(maxDurationTimeout);
    }
    maxDurationTimeout = setTimeout(() => {
      if (isRecording) {
        console.log('Maximum recording duration timeout reached, forcing stop');
        stopRecording();
      }
    }, MAX_RECORDING_DURATION);
    
    // Start VAD checking after a short delay (to avoid immediate stops)
    setTimeout(() => {
      if (isRecording) {
        checkVAD();
      }
    }, 500);
  }

  // Start recording
  async function startRecording(playDing = true) {
    try {
      // Play ding sound to indicate it's the user's turn to speak (unless suppressed)
      if (playDing) {
        playDingSound();
      }

      // Initialize socket if not already connected - wait for connection
      if (!socket || !socket.connected) {
        console.log('Initializing socket connection...');
        try {
          await initSocket();
          console.log('Socket connected successfully');
        } catch (error) {
          console.error('Failed to connect socket:', error);
          if (audioStatusText) {
            audioStatusText.textContent = 'Error: Could not connect to audio service';
          }
          updateVoiceButtons('idle');
          return;
        }
      }

      // Verify socket is connected before proceeding
      if (!socket || !socket.connected) {
        console.error('Socket not connected after initialization');
        if (audioStatusText) {
          audioStatusText.textContent = 'Error: Audio service not connected';
        }
        updateVoiceButtons('idle');
        return;
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
          console.log('[START_RECORDING] Starting visualization loop');
          visualize();
        } else {
          console.log('[START_RECORDING] Visualization already running, animationId:', animationId);
        }
      }
      
      // Log visualizer state
      console.log('[START_RECORDING] Visualizer state:', {
        hasAnalyser: !!analyser,
        hasAudioContext: !!audioContext,
        audioContextState: audioContext?.state,
        hasDataArray: !!dataArray,
        animationId: animationId,
        waveVisualizerDisplay: audioWaveVisualizer?.style.display,
        waveVisualizerExists: !!audioWaveVisualizer
      });

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
      // Don't reset maxAudioLevel here - let it persist so relative threshold works
      // It will be reset when VAD detects new speech or when recording actually stops

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          // Store chunks locally instead of sending immediately
          recordedChunks.push(event.data);
          console.log('Recorded chunk:', event.data.size, 'bytes, total chunks:', recordedChunks.length);
        }
      };

      // Store maxAudioLevel in closure so it persists even if reset elsewhere
      let savedMaxAudioLevel = maxAudioLevel;
      
      mediaRecorder.onstop = async () => {
        console.log('Recording stopped, processing', recordedChunks.length, 'chunks');
        // Use saved value if current maxAudioLevel was reset
        const finalMaxAudioLevel = maxAudioLevel > 0 ? maxAudioLevel : savedMaxAudioLevel;
        maxAudioLevel = finalMaxAudioLevel; // Restore it
        console.log('Maximum audio level detected:', maxAudioLevel.toFixed(2), '(saved:', savedMaxAudioLevel.toFixed(2), ')');

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

        // Check if audio has meaningful content before sending
        // Lowered threshold significantly to catch quieter voices (was 15, now 3)
        const MIN_AUDIO_LEVEL = 3; // Even lower threshold to accept quiet voices
        console.log('Recording stopped. Checking audio quality. maxAudioLevel:', maxAudioLevel.toFixed(2), 'MIN_AUDIO_LEVEL:', MIN_AUDIO_LEVEL, 'chunks:', recordedChunks.length);
        if (maxAudioLevel < MIN_AUDIO_LEVEL) {
          console.log('Audio level too low (', maxAudioLevel.toFixed(2), ' < ', MIN_AUDIO_LEVEL, '), not sending. Likely silence or background noise.');
          if (audioStatusText) {
            audioStatusText.textContent = 'No speech detected. Please try again.';
          }
          // Reset max audio level for next recording
          maxAudioLevel = 0;
          // Clear chunks without sending
          recordedChunks = [];
          // In continuous mode, restart listening after a short delay
          // Don't play ding again since we're just continuing to listen
          if (continuousMode) {
            setTimeout(() => {
              if (audioStatusText) {
                audioStatusText.textContent = 'Listening... Speak now';
              }
              startRecording(false); // Don't play ding when restarting after no speech detected
            }, 1000);
          } else {
            updateVoiceButtons('idle');
          }
          return;
        }

        // Create a complete blob from all chunks
        if (recordedChunks.length > 0) {
          if (!socket || !socket.connected) {
            console.error('Socket not connected when trying to send audio!');
            if (audioStatusText) {
              audioStatusText.textContent = 'Error: Lost connection to audio service';
            }
            updateVoiceButtons('idle');
            // Reset max audio level
            maxAudioLevel = 0;
            return;
          }

          const audioBlob = new Blob(recordedChunks, { type: mimeType });
          console.log('Created audio blob:', audioBlob.size, 'bytes, type:', audioBlob.type);
          console.log('Chunks collected:', recordedChunks.length);
          console.log('Individual chunk sizes:', recordedChunks.map(c => c.size));
          console.log('Audio quality check passed. Max level:', maxAudioLevel.toFixed(2));
          
          if (audioBlob.size === 0) {
            console.error('Audio blob is empty!');
            if (audioStatusText) {
              audioStatusText.textContent = 'Error: No audio recorded';
            }
            updateVoiceButtons('idle');
            maxAudioLevel = 0;
            return;
          }
          
          // Send the complete audio blob
          const arrayBuffer = await audioBlob.arrayBuffer();
          console.log('Sending arrayBuffer size:', arrayBuffer.byteLength, 'bytes to socket');
          
          // Update UI to show we're sending and will start transcribing
          updateVoiceButtons('processing');
          if (audioStatusText) {
            audioStatusText.textContent = 'Sending audio...';
          }
          
          try {
            socket.emit('audio-complete', {
              audio: arrayBuffer,
              mimeType: mimeType
            });
            console.log('Audio sent successfully to server - transcription starting');
            // Status will be updated by 'status' event when transcription actually starts
            if (audioStatusText) {
              audioStatusText.textContent = 'Transcribing audio...';
            }
          } catch (error) {
            console.error('Error sending audio:', error);
            if (audioStatusText) {
              audioStatusText.textContent = 'Error sending audio';
            }
            updateVoiceButtons('idle');
          }
          
          // Clear chunks and reset max audio level
          recordedChunks = [];
          maxAudioLevel = 0;
        } else {
          console.error('No chunks recorded!');
          if (audioStatusText) {
            audioStatusText.textContent = 'Error: No audio recorded';
          }
          updateVoiceButtons('idle');
          maxAudioLevel = 0;
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
      
      // NOW start visualization (after isRecording is set to true)
      // This ensures the animation loop actually runs
      if (!analyser || !audioContext || audioContext.state === 'closed') {
        console.log('[START_RECORDING] Visualizer not initialized, initializing now');
        initAudioVisualizer(audioStream);
      } else if (!animationId) {
        console.log('[START_RECORDING] Starting visualization loop after isRecording set');
        visualize();
      }

      // Update UI
      updateVoiceButtons('listening'); // Show "Agent is Listening" button
      if (recordButton) {
        recordButton.classList.add('recording');
        if (continuousMode) {
          recordButton.innerHTML = '<span class="record-icon recording-icon"></span><span>Stop Conversation</span>';
        } else {
          recordButton.innerHTML = '<span class="record-icon recording-icon"></span><span>Recording... (auto-stops on silence)</span>';
        }
      }
      if (audioStatusText) {
        audioStatusText.textContent = 'Listening... Speak now';
      }
      if (audioVisualizerBars) {
        audioVisualizerBars.classList.add('active');
      }
      // Note: audioVisualizerBars may not exist in v2 design - that's OK

    } catch (error) {
      console.error('Error starting recording:', error);
      if (audioStatusText) {
        audioStatusText.textContent = 'Error: Could not access microphone';
        setTimeout(() => {
          audioStatusText.textContent = 'Click microphone to start voice order';
        }, 3000);
      }
      updateVoiceButtons('idle');
    }
  }

  // Stop recording
  function stopRecording() {
    const stopRecStart = performance.now();
    console.log(`[STOP_RECORDING ${stopRecStart.toFixed(2)}ms] stopRecording() called, maxAudioLevel BEFORE stop: ${maxAudioLevel.toFixed(2)}`);
    
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      // Save maxAudioLevel BEFORE setting isRecording = false (VAD might reset it)
      const savedMaxAudioLevel = maxAudioLevel;
      console.log(`[STOP_RECORDING ${performance.now().toFixed(2)}ms] Saved maxAudioLevel: ${savedMaxAudioLevel.toFixed(2)}`);
      
      isRecording = false;
      
      // IMMEDIATELY update UI to show processing state - don't wait for mediaRecorder.stop()
      // This gives instant visual feedback when user stops speaking
      
      // Stop the visualizer animation FIRST - this is critical to stop waves immediately
      const stopAnimTime = performance.now();
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
        console.log(`[STOP_RECORDING ${stopAnimTime.toFixed(2)}ms] Cancelled animation frame`);
      }
      
      // Hide wave visualizer immediately - force stop waves
      const hideWavesTime = performance.now();
      if (audioWaveVisualizer) {
        audioWaveVisualizer.style.display = 'none';
        console.log(`[STOP_RECORDING ${hideWavesTime.toFixed(2)}ms] Hid wave visualizer`);
      }
      if (audioVisualizerBars) {
        audioVisualizerBars.classList.remove('active');
      }
      
      // Now update UI to processing state
      const uiUpdateTime = performance.now();
      updateVoiceButtons('processing'); // Always show processing state immediately
      if (audioStatusText) {
        audioStatusText.textContent = 'Preparing audio...';
      }
      console.log(`[STOP_RECORDING ${uiUpdateTime.toFixed(2)}ms] Updated UI to processing - UI update took ${(uiUpdateTime - hideWavesTime).toFixed(2)}ms`);
      
      // Now stop the media recorder
      const stopMediaRecTime = performance.now();
      mediaRecorder.stop();
      console.log(`[STOP_RECORDING ${stopMediaRecTime.toFixed(2)}ms] mediaRecorder.stop() called - Total stopRecording time: ${(stopMediaRecTime - stopRecStart).toFixed(2)}ms`);

      // Clear any silence timeout
      if (silenceTimeout) {
        clearTimeout(silenceTimeout);
        silenceTimeout = null;
      }
      // Clear maximum duration timeout
      if (maxDurationTimeout) {
        clearTimeout(maxDurationTimeout);
        maxDurationTimeout = null;
      }
    }
  }

  // Stop continuous mode
  function stopContinuousMode() {
    continuousMode = false;
    isProcessingResponse = false;
    maxAudioLevel = 0; // Reset max audio level

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
    // Stop speaking animation if running
    stopSpeakingWaveAnimation();
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close();
      audioContext = null;
      analyser = null;
      dataArray = null;
    }

    // Update UI
    updateVoiceButtons('idle'); // Show "Speak to Agent" button
    if (recordButton) {
      recordButton.classList.remove('recording', 'continuous-mode');
      recordButton.innerHTML = '<span class="record-icon"></span><span>Start Voice Order</span>';
    }
    if (audioStatusText) {
      audioStatusText.textContent = 'Click microphone to start voice order';
    }
    if (audioVisualizerBars) {
      audioVisualizerBars.classList.remove('active');
    }
    // Note: audioVisualizerBars may not exist in v2 design - that's OK
  }

  // Toggle recording
  if (recordButton) {
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
  }

  // "Speak to Agent" button click handler
  if (speakToAgentButton) {
    speakToAgentButton.addEventListener('click', () => {
      // Unlock audio playback on first interaction (Safari requirement)
      if (!audioContext || audioContext.state === 'closed') {
        const unlockAudio = new (window.AudioContext || window.webkitAudioContext)();
        const silentSource = unlockAudio.createBufferSource();
        silentSource.buffer = unlockAudio.createBuffer(1, 1, 22050);
        silentSource.connect(unlockAudio.destination);
        silentSource.start(0);
        console.log('Audio unlocked for autoplay');
      }
      
      // Start continuous voice conversation mode
      if (!continuousMode && !isRecording) {
        continuousMode = true;
        if (recordButton) {
          recordButton.classList.add('continuous-mode');
        }
        startRecording();
      }
    });
  }

  // "Stop Voice" button click handler
  if (stopVoiceButton) {
    stopVoiceButton.addEventListener('click', () => {
      console.log('Stop voice button clicked');
      stopContinuousMode();
    });
  }

  // Listen for chat response completion to trigger TTS
  window.addEventListener('chat-response-complete', (event) => {
    // Only process if we're in voice mode (continuous mode or processing response)
    if (!continuousMode && !isProcessingResponse) return;

    const timestamp = new Date().toISOString();
    const responseText = event.detail.text;
    console.log(`[${timestamp}] Chat response complete, requesting TTS for:`, responseText);

    // Mark that we're processing a response
    isProcessingResponse = true;

    if (responseText && responseText.trim()) {
      if (socket && socket.connected) {
        socket.emit('tts-request', {
          text: responseText,
          voice: 'af_sky'
        });
        console.log(`[${timestamp}] TTS request sent`);
      } else {
        console.error('Socket not connected, cannot request TTS');
        handleResponseComplete();
      }
    } else {
      // No text to speak, just complete the response
      console.log(`[${timestamp}] No text to speak, completing response`);
      handleResponseComplete();
    }
  });

});

