import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, StopCircle, Loader2, Volume2, User, Gavel } from 'lucide-react';

// URL de tu endpoint de backend que recibe TEXTO y devuelve AUDIO TTS
const TEXT_QUERY_URL = "https://286272f9581f.ngrok-free.app/api/text_query";

const VoiceAssistant = () => {
    // === ESTADOS ===
    const [isRecording, setIsRecording] = useState(false);      // Estado de grabación activa
    const [isLoading, setIsLoading] = useState(false);          // Esperando respuesta del backend
    const [responseAudioUrl, setResponseAudioUrl] = useState(null);
    const [transcriptionPreview, setTranscriptionPreview] = useState(""); // Texto actual (interino + final)
    const [statusMessage, setStatusMessage] = useState("Presiona el micrófono para INICIAR la consulta.");
    const [username, setUsername] = useState("");

    // === REFERENCIAS ===
    const recognitionRef = useRef(null);
    const audioPlayerRef = useRef(null);
    const hasSentRef = useRef(false); // Bandera para evitar doble envío
    const finalTranscriptRef = useRef(""); // Para guardar la transcripción final más reciente

    // === UTILIDADES INTERNAS ===

    // Función para manejar errores y restablecer el estado
    const showCustomError = useCallback((message) => {
        setStatusMessage(message);
        setIsLoading(false);
        setIsRecording(false);
        hasSentRef.current = false;
        finalTranscriptRef.current = ""; // Limpiar texto guardado
        // Intentar abortar la API de voz si está activa o en estado pendiente
        if (recognitionRef.current) {
             recognitionRef.current.abort();
        }
    }, []);
    
    // Función para enviar la consulta de TEXTO al backend
    const sendTextQuery = useCallback(async (textToSend) => {
        const cleanedText = textToSend.trim();
        if (!cleanedText || hasSentRef.current) {
            if (!cleanedText && !isLoading) showCustomError("⚠️ No se detectó ninguna consulta de voz válida.");
            return;
        }
        
        hasSentRef.current = true;
        setIsLoading(true);
        // Aseguramos que la grabación se detenga visualmente
        setIsRecording(false); 

        try {
            // 1. Envío de la consulta de texto
            const response = await fetch(TEXT_QUERY_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    query_text: cleanedText, // Usamos el texto limpio y verificado
                    username: username, 
                }),
            });

            if (!response.ok) {
                let errorDetails = `Error del servidor (Status: ${response.status}).`;
                try {
                    const errorJson = await response.json();
                    errorDetails = errorJson.message || JSON.stringify(errorJson); 
                } catch {}
                throw new Error(errorDetails);
            }
            
            // 2. Esperamos un Blob de audio (TTS)
            const audioResponseBlob = await response.blob();
            
            if (audioResponseBlob.size === 0) {
                throw new Error("El audio de respuesta está vacío.");
            }

            // 3. Reproducción Automática
            if (responseAudioUrl) {
                URL.revokeObjectURL(responseAudioUrl);
            }
            
            const url = URL.createObjectURL(audioResponseBlob);
            setResponseAudioUrl(url);
            
            setTimeout(async () => {
                if (audioPlayerRef.current) {
                    audioPlayerRef.current.load();
                    try {
                        await audioPlayerRef.current.play();
                        setStatusMessage("✅ Asesoría recibida. Reproduciendo automáticamente...");
                    } catch (e) {
                        console.warn("Fallo la reproducción automática, el usuario debe hacer clic en Play:", e);
                        setStatusMessage("✅ Asesoría recibida. (Fallo Autoplay. ¡Debes presionar Play manualmente!)");
                    }
                }
            }, 100);

        } catch (error) {
            console.error("Error en la consulta al backend:", error.message);
            showCustomError(`❌ Error en la consulta: ${error.message}.`);
        } finally {
            setIsLoading(false);
        }
    }, [responseAudioUrl, username, isLoading, showCustomError]);


    // === EFECTO DE INICIALIZACIÓN Y STT (Web Speech API) ===
    useEffect(() => {
        // --- Manejo del Nombre de Usuario ---
        if (!username) {
            const storedName = localStorage.getItem('v2v_username');
            if (storedName) {
                setUsername(storedName);
            }
        }

        // --- Inicialización de Web Speech API ---
        if ('webkitSpeechRecognition' in window) {
            const recognition = recognitionRef.current || new window.webkitSpeechRecognition();
            recognition.continuous = true; 
            recognition.interimResults = true; // Usamos resultados interinos para feedback visual
            recognition.lang = 'es-ES'; 
            recognitionRef.current = recognition;

            // Almacena el texto final acumulado mientras se graba
            finalTranscriptRef.current = "";

            recognition.onresult = (event) => {
                let finalTranscriptPart = '';
                let interimTranscriptPart = '';
                
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        // Concatenar resultados finales para acumular frases
                        finalTranscriptPart += event.results[i][0].transcript;
                    } else {
                        // Almacenar el resultado interino (en curso)
                        interimTranscriptPart += event.results[i][0].transcript;
                    }
                }
                
                // 1. Actualizar la referencia del texto final acumulado
                if (finalTranscriptPart) {
                    finalTranscriptRef.current += finalTranscriptPart;
                }
                
                // 2. Actualizar la vista previa (final acumulado + interino en curso)
                setTranscriptionPreview(finalTranscriptRef.current + interimTranscriptPart);
            };

            recognition.onerror = (event) => {
                if (hasSentRef.current) return; 

                if (event.error === 'not-allowed') {
                    showCustomError("❌ Acceso al micrófono bloqueado. Debes permitirlo en la configuración.");
                } else if (event.error !== 'no-speech' && event.error !== 'audio-capture') {
                     showCustomError(`❌ Error de STT (${event.error}). Intenta de nuevo.`);
                }
                setIsRecording(false);
            };

            recognition.onend = () => {
                if (!hasSentRef.current && !isLoading) {
                    setIsRecording(false);
                    setStatusMessage("Grabación detenida. Presiona para empezar de nuevo.");
                }
            };
            
            // Limpieza
            return () => {
                if (responseAudioUrl) URL.revokeObjectURL(responseAudioUrl);
                if (recognitionRef.current) recognitionRef.current.abort(); 
            };
            
        } else {
            showCustomError("⚠️ Navegador no compatible con Web Speech API para STT.");
            recognitionRef.current = null;
        }

    }, [username, responseAudioUrl, isLoading, showCustomError, sendTextQuery]); 
    
    // === LÓGICA DE INTERACCIÓN (TOGGLE) ===
    const handleVoiceToggle = () => {
        if (!recognitionRef.current || isLoading) return;

        if (!username) {
            showCustomError("❌ Por favor, ingresa tu nombre antes de comenzar.");
            return;
        }

        if (isRecording) {
            // Caso 1: Estaba grabando -> Detener y ENVIAR
            setIsRecording(false);
            setStatusMessage("Deteniendo, esperando transcripción final...");
            
            // 1. Intentar detener la API de Voz
            try {
                recognitionRef.current.stop(); 
            } catch (e) {
                console.warn("Error al llamar a recognition.stop().");
            }

            // 2. AÑADIMOS UN PEQUEÑO RETRASO para dar tiempo a que la API actualice 'finalTranscriptRef'
            setTimeout(() => {
                let textToSend = finalTranscriptRef.current.trim();
                
                // FALLBACK: Si la referencia interna está vacía, usamos el texto de la vista previa
                if (!textToSend && transcriptionPreview.trim()) {
                    textToSend = transcriptionPreview.trim();
                    console.log("Usando texto de fallback (Vista Previa) para enviar:", textToSend);
                }

                // 3. ENVIAR
                if (textToSend) {
                    setStatusMessage("✅ Transcripción capturada. Enviando al Asesor IA...");
                    sendTextQuery(textToSend);
                } else {
                    // Si incluso después del retraso no hay texto, mostramos el error
                    showCustomError("⚠️ No se detectó ninguna consulta de voz válida.");
                }
                
                // Limpiamos la vista previa después de tomar la decisión
                setTranscriptionPreview("");
            }, 50); // Retraso de 50ms para sincronización móvil


        } else {
            // Caso 2: No estaba grabando -> Iniciar grabación
            setResponseAudioUrl(null);
            setTranscriptionPreview("");
            hasSentRef.current = false;
            finalTranscriptRef.current = ""; // Limpiar texto final guardado
            
            try {
                // Intentar abortar cualquier estado anterior antes de empezar
                recognitionRef.current.abort();
                
                recognitionRef.current.start();
                setIsRecording(true);
                setStatusMessage("🔴 Grabando Audio. Presiona de nuevo para DETENER y enviar.");
            } catch (error) {
                if (error.name !== 'InvalidStateError') {
                    showCustomError(`❌ Error al iniciar grabación: ${error.message}`);
                }
            }
        }
    };

    // === MANEJO DEL NOMBRE DE USUARIO ===
    const handleNameSubmit = (e) => {
        e.preventDefault();
        const input = e.target.elements.nameInput.value.trim();
        if (input) {
            setUsername(input);
            localStorage.setItem('v2v_username', input);
            setStatusMessage("Listo. Presiona el micrófono para INICIAR la consulta.");
        }
    };


    // === ESTRUCTURA DEL COMPONENTE ===
    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" style={{ fontFamily: 'Inter, sans-serif' }}>
            
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                {`
                    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
                    body {
                        font-family: 'Inter', sans-serif;
                        background-color: #f9fafb;
                        min-height: 100vh;
                        overflow-y: auto; 
                    }

                    svg {
                        stroke-width: 2.5;
                    }
                `}
            </style>

            <div className="bg-white shadow-2xl rounded-xl p-8 w-full max-w-lg transition-all duration-300 border-t-4 border-blue-600">
                
                {/* Header */}
                <div className="text-center mb-6">
                    <Gavel className="w-10 h-10 text-blue-600 mx-auto mb-2" />
                    <h1 className="text-3xl font-extrabold text-gray-900">Asistente Legal STT Local (Sincronización Reforzada)</h1>
                    <p className="text-sm text-gray-500">Máximo control para STT en iOS/móviles.</p>
                    {username ? (
                        <p className="text-sm text-gray-500 mt-1 flex items-center justify-center">
                            <User className="w-4 h-4 mr-1"/> Usuario: <span className="font-semibold text-blue-600 ml-1">{username}</span>
                        </p>
                    ) : (
                        <form onSubmit={handleNameSubmit} className="mt-4 flex gap-2">
                            <input
                                name="nameInput"
                                type="text"
                                placeholder="Ingresa tu nombre..."
                                required
                                className="flex-grow p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                            />
                            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                                OK
                            </button>
                        </form>
                    )}
                </div>

                {/* Área de Estado */}
                {username && (
                    <div className={`p-4 rounded-lg text-center font-medium ${
                        isLoading ? 'bg-yellow-100 text-yellow-800 border border-yellow-300' :
                        isRecording ? 'bg-red-100 text-red-800 border border-red-300 animate-pulse' :
                        (statusMessage.includes('❌') || statusMessage.includes('Error') || statusMessage.includes('⚠️')) ? 'bg-red-100 text-red-800 border border-red-300' : 
                        responseAudioUrl ? 'bg-green-100 text-green-800 border border-green-300' :
                        'bg-gray-50 text-gray-600 border border-gray-200'
                    } transition-colors duration-300 mb-4 min-h-[4rem] flex items-center justify-center`}>
                        <p className="text-base">{statusMessage}</p>
                    </div>
                )}

                {/* Transcripción mostrada */}
                {(transcriptionPreview) && (
                    <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-sm mb-6 border border-blue-200 shadow-inner">
                        <span className="font-semibold">Tu consulta (Vista Previa):</span> {transcriptionPreview}
                    </div>
                )}
                
                {/* Controles de Voz */}
                <div className="flex justify-center space-x-4">
                    
                    {/* Botón de Iniciar/Detener (Toggle Mode) */}
                    <button
                        onClick={handleVoiceToggle}
                        className={`p-5 rounded-full shadow-xl transition-all duration-300 flex items-center justify-center
                            ${isRecording 
                                ? 'bg-red-600 hover:bg-red-700 ring-4 ring-red-300 text-white transform scale-105' 
                                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/50'
                            }
                            disabled:opacity-50 disabled:cursor-not-allowed w-20 h-20
                        `}
                        disabled={isLoading || !username || !recognitionRef.current}
                        title={isRecording ? "Presiona para DETENER la grabación y enviar" : "Presiona para INICIAR la grabación"}
                    >
                        {isLoading ? <Loader2 className="w-8 h-8 animate-spin" /> : isRecording ? <StopCircle className="w-8 h-8 animate-pulse"/> : <Mic className="w-8 h-8"/>}
                    </button>
                </div>

                {/* Reproductor de Audio */}
                {responseAudioUrl && (
                    <div className="mt-8 pt-4 border-t border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center">
                            <Volume2 className="w-5 h-5 mr-2 text-green-600"/> Respuesta del Asesor IA
                        </h3>
                        <audio 
                            ref={audioPlayerRef} 
                            src={responseAudioUrl} 
                            controls 
                            className="w-full h-12 rounded-lg shadow-md"
                        />
                    </div>
                )}

            </div>
        </div>
    );
};

export default VoiceAssistant;