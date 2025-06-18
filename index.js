import express from 'express';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { URL } from 'url';

// --- Servidor Express ---
const app = express();
app.use(express.json({ limit: '10mb' })); // Aumenta o limite do body para acomodar textos longos
const PORT = process.env.PORT || 8698;

const GEMINI_TTS_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/text-to-speech:generateText';


// --- Dados Estáticos (Vozes e Idiomas) ---
const AVAILABLE_LANGUAGES = [
  { "language": "Arabic (Egyptian)", "code": "ar-EG" },
  { "language": "English (US)", "code": "en-US" },
  { "language": "French (France)", "code": "fr-FR" },
  { "language": "Indonesian (Indonesia)", "code": "id-ID" },
  { "language": "Japanese (Japan)", "code": "ja-JP" },
  { "language": "Portuguese (Brazil)", "code": "pt-BR" },
  { "language": "Dutch (Netherlands)", "code": "nl-NL" },
  { "language": "Thai (Thailand)", "code": "th-TH" },
  { "language": "Vietnamese (Vietnam)", "code": "vi-VN" },
  { "language": "Ukrainian (Ukraine)", "code": "uk-UA" },
  { "language": "English (India)", "code": "en-IN" },
  { "language": "Tamil (India)", "code": "ta-IN" },
  { "language": "German (Germany)", "code": "de-DE" },
  { "language": "Spanish (US)", "code": "es-US" },
  { "language": "Hindi (India)", "code": "hi-IN" },
  { "language": "Italian (Italy)", "code": "it-IT" },
  { "language": "Korean (Korea)", "code": "ko-KR" },
  { "language": "Russian (Russia)", "code": "ru-RU" },
  { "language": "Polish (Poland)", "code": "pl-PL" },
  { "language": "Turkish (Turkey)", "code": "tr-TR" },
  { "language": "Romanian (Romania)", "code": "ro-RO" },
  { "language": "Bengali (Bangladesh)", "code": "bn-BD" },
  { "language": "Marathi (India)", "code": "mr-IN" },
  { "language": "Telugu (India)", "code": "te-IN" }
];

const AVAILABLE_VOICES = [
    { "voice": "Zephyr", "style": "Bright" }, { "voice": "Kore", "style": "Firm" },
    { "voice": "Orus", "style": "Firm" }, { "voice": "Autonoe", "style": "Bright" },
    { "voice": "Umbriel", "style": "Easy-going" }, { "voice": "Erinome", "style": "Clear" },
    { "voice": "Laomedeia", "style": "Upbeat" }, { "voice": "Schedar", "style": "Even" },
    { "voice": "Achird", "style": "Friendly" }, { "voice": "Sadachbia", "style": "Lively" },
    { "voice": "Puck", "style": "Upbeat" }, { "voice": "Fenrir", "style": "Excitable" },
    { "voice": "Aoede", "style": "Breezy" }, { "voice": "Enceladus", "style": "Breathy" },
    { "voice": "Algieba", "style": "Smooth" }, { "voice": "Algenib", "style": "Gravelly" },
    { "voice": "Achernar", "style": "Soft" }, { "voice": "Gacrux", "style": "Mature" },
    { "voice": "Zubenelgenubi", "style": "Casual" }, { "voice": "Sadaltager", "style": "Knowledgeable" },
    { "voice": "Charon", "style": "Informative" }, { "voice": "Leda", "style": "Youthful" },
    { "voice": "Callirrhoe", "style": "Easy-going" }, { "voice": "Iapetus", "style": "Clear" },
    { "voice": "Despina", "style": "Smooth" }, { "voice": "Rasalgethi", "style": "Informative" },
    { "voice": "Alnilam", "style": "Firm" }, { "voice": "Pulcherrima", "style": "Forward" },
    { "voice": "Vindemiatrix", "style": "Gentle" }, { "voice": "Sulafat", "style": "Warm" }
];


// --- Funções Auxiliares para Conversão de Áudio ---
// Baseado no exemplo fornecido pelo usuário.

/**
 * @typedef {object} WavConversionOptions
 * @property {number} numChannels
 * @property {number} sampleRate
 * @property {number} bitsPerSample
 */

/**
 * Analisa o mimeType para extrair opções de conversão.
 * @param {string} mimeType - O mime type do áudio, ex: "audio/L16;codec=pcm;rate=24000".
 * @returns {WavConversionOptions}
 */
function parseMimeType(mimeType) {
    console.log(`[LOG] Analisando MIME type: ${mimeType}`);
    const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
    const [_, format] = fileType.split('/');

    const options = {
        numChannels: 1, // Gemini TTS é mono
        bitsPerSample: 16, // Padrão para L16
        sampleRate: 24000 // Padrão para Gemini TTS
    };

    if (format && format.toUpperCase().startsWith('L')) {
        const bits = parseInt(format.slice(1), 10);
        if (!isNaN(bits)) {
            options.bitsPerSample = bits;
        }
    }

    for (const param of params) {
        const [key, value] = param.split('=').map(s => s.trim());
        if (key.toLowerCase() === 'rate' && !isNaN(parseInt(value, 10))) {
            options.sampleRate = parseInt(value, 10);
        }
    }
    console.log(`[LOG] Opções de áudio extraídas:`, options);
    return options;
}

/**
 * Cria o cabeçalho de um arquivo WAV.
 * @param {number} dataLength - O tamanho dos dados de áudio brutos.
 * @param {WavConversionOptions} options - As opções de formato do áudio.
 * @returns {Buffer} - O buffer contendo o cabeçalho WAV.
 */
function createWavHeader(dataLength, options) {
    const { numChannels, sampleRate, bitsPerSample } = options;
    // Referência: http://soundfile.sapp.org/doc/WaveFormat/
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const buffer = Buffer.alloc(44);

    buffer.write('RIFF', 0);                          // ChunkID
    buffer.writeUInt32LE(36 + dataLength, 4);         // ChunkSize
    buffer.write('WAVE', 8);                          // Format
    buffer.write('fmt ', 12);                         // Subchunk1ID
    buffer.writeUInt32LE(16, 16);                     // Subchunk1Size (PCM)
    buffer.writeUInt16LE(1, 20);                      // AudioFormat (1 = PCM)
    buffer.writeUInt16LE(numChannels, 22);            // NumChannels
    buffer.writeUInt32LE(sampleRate, 24);             // SampleRate
    buffer.writeUInt32LE(byteRate, 28);               // ByteRate
    buffer.writeUInt16LE(blockAlign, 32);             // BlockAlign
    buffer.writeUInt16LE(bitsPerSample, 34);          // BitsPerSample
    buffer.write('data', 36);                         // Subchunk2ID
    buffer.writeUInt32LE(dataLength, 40);             // Subchunk2Size

    console.log('[LOG] Cabeçalho WAV criado.');
    return buffer;
}

/**
 * Converte os dados de áudio brutos (base64) em um buffer WAV completo.
 * @param {string} rawData - Os dados de áudio em base64.
 * @param {string} mimeType - O mime type original.
 * @returns {Buffer}
 */
function convertToWav(rawData, mimeType) {
    console.log('[LOG] Iniciando conversão para WAV.');
    const audioDataBuffer = Buffer.from(rawData, 'base64');
    const options = parseMimeType(mimeType);
    const wavHeader = createWavHeader(audioDataBuffer.length, options);

    const wavBuffer = Buffer.concat([wavHeader, audioDataBuffer]);
    console.log(`[LOG] Conversão para WAV concluída. Tamanho final: ${wavBuffer.length} bytes.`);
    return wavBuffer;
}


// --- Endpoints da API ---

// 1. Health Check
app.get('/health', (req, res) => {
    console.log('[LOG] Recebida requisição em /health.');
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

// 2. Listar Idiomas
app.get('/languages', (req, res) => {
    console.log('[LOG] Recebida requisição em /languages.');
    res.status(200).json(AVAILABLE_LANGUAGES);
});

// 3. Listar Vozes
app.get('/voices', (req, res) => {
    console.log('[LOG] Recebida requisição em /voices.');
    res.status(200).json(AVAILABLE_VOICES);
});

// 4. Gerar Áudio
app.post('/generate-audio', async (req, res) => {
    console.log('[LOG] Recebida requisição em /generate-audio.');

    const geminiApiKey = req.query.key;
    if (!geminiApiKey) {
        console.error('[ERROR] Chave da API do Gemini não fornecida na query `key`.');
        return res.status(401).json({ error: 'Gemini API key is required. Please provide it in the `key` query parameter.' });
    }

    const proxyUrl = req.headers.proxy_url;
    let httpsAgent;

    const axiosConfig = {
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': geminiApiKey,
        },
        // A API do Gemini não retorna o áudio diretamente, mas um JSON com o áudio em base64
        responseType: 'json', 
    };

    if (proxyUrl) {
        console.log(`[LOG] Utilizando proxy: ${proxyUrl}`);
        try {
            const parsedUrl = new URL(proxyUrl);
            const protocol = parsedUrl.protocol.toLowerCase();

            if (protocol.startsWith('socks')) {
                httpsAgent = new SocksProxyAgent(proxyUrl);
            } else if (protocol.startsWith('http')) {
                httpsAgent = new HttpsProxyAgent(proxyUrl);
            } else {
                throw new Error(`Protocolo de proxy não suportado: ${protocol}`);
            }
            axiosConfig.httpsAgent = httpsAgent;
            axiosConfig.proxy = false; // Desativa o proxy padrão do axios para usar o agente
        } catch (error) {
            console.error(`[ERROR] URL de proxy inválida: ${proxyUrl}`, error);
            return res.status(400).json({ error: 'Invalid proxy_url header format or protocol.', details: error.message });
        }
    } else {
        console.log('[LOG] Nenhuma proxy foi informada. Conectando diretamente.');
    }

    try {
        console.log('[LOG] Enviando requisição para a API do Gemini TTS...');
        
        const response = await axios.post(GEMINI_TTS_API_URL, req.body, axiosConfig);

        console.log('[LOG] Resposta recebida da API do Gemini.');

        if (response.data && response.data.audioContent) {
            const audioBase64 = response.data.audioContent;
            // A API de texto para fala já devolve o mimeType correto, mas vamos garantir o WAV
            const wavBuffer = convertToWav(audioBase64, "audio/L16;rate=24000"); // Gemini TTS retorna 24kHz 16-bit PCM

            res.setHeader('Content-Type', 'audio/wav');
            res.setHeader('Content-Disposition', 'attachment; filename="audio.wav"');
            res.status(200).send(wavBuffer);
            console.log('[LOG] Arquivo de áudio .wav enviado com sucesso.');
        } else {
            console.error('[ERROR] A resposta da API do Gemini não continha o `audioContent` esperado.', response.data);
            res.status(500).json({
                error: 'Failed to generate audio. The response from Gemini API was invalid.',
                geminiResponse: response.data 
            });
        }
    } catch (error) {
        console.error('[ERROR] Erro ao chamar a API do Gemini:', error.response ? error.response.data : error.message);
        res.status(error.response?.status || 500).json({
            error: 'An error occurred while calling the Gemini API.',
            details: error.response?.data?.error || error.message
        });
    }
});

// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`[LOG] Servidor da API Gemini TTS Proxy iniciado na porta ${PORT}`);
    console.log(`[LOG] Endpoints disponíveis:`);
    console.log(`  - GET  http://localhost:${PORT}/health`);
    console.log(`  - GET  http://localhost:${PORT}/voices`);
    console.log(`  - GET  http://localhost:${PORT}/languages`);
    console.log(`  - POST http://localhost:${PORT}/generate-audio?key=SUA_CHAVE_GEMINI`);
});