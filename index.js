import express from 'express';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { URL } from 'url';
import fs from 'fs/promises'; // Importa o módulo File System (para salvar arquivos)
import path from 'path'; // Importa o módulo Path (para manipular caminhos de forma segura)

// --- Servidor Express ---
const app = express();
app.use(express.json({ limit: '10mb' }));
const PORT = process.env.PORT || 8698;

// --- URLs dos Endpoints do Gemini ---
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const GEMINI_TEXT_MODEL = 'gemini-1.5-flash-latest';
const GEMINI_TTS_API_URL = `${GEMINI_API_BASE_URL}/${GEMINI_TTS_MODEL}:generateContent`;
const GEMINI_TEXT_API_URL = `${GEMINI_API_BASE_URL}/${GEMINI_TEXT_MODEL}:generateContent`;

// --- Dados Estáticos (Vozes e Idiomas) ---
const AVAILABLE_LANGUAGES = [
    { "language": "Arabic (Egyptian)", "code": "ar-EG" }, { "language": "English (US)", "code": "en-US" },
    { "language": "French (France)", "code": "fr-FR" }, { "language": "Indonesian (Indonesia)", "code": "id-ID" },
    { "language": "Japanese (Japan)", "code": "ja-JP" }, { "language": "Portuguese (Brazil)", "code": "pt-BR" },
    { "language": "Dutch (Netherlands)", "code": "nl-NL" }, { "language": "Thai (Thailand)", "code": "th-TH" },
    { "language": "Vietnamese (Vietnam)", "code": "vi-VN" }, { "language": "Ukrainian (Ukraine)", "code": "uk-UA" },
    { "language": "English (India)", "code": "en-IN" }, { "language": "Tamil (India)", "code": "ta-IN" },
    { "language": "German (Germany)", "code": "de-DE" }, { "language": "Spanish (US)", "code": "es-US" },
    { "language": "Hindi (India)", "code": "hi-IN" }, { "language": "Italian (Italy)", "code": "it-IT" },
    { "language": "Korean (Korea)", "code": "ko-KR" }, { "language": "Russian (Russia)", "code": "ru-RU" },
    { "language": "Polish (Poland)", "code": "pl-PL" }, { "language": "Turkish (Turkey)", "code": "tr-TR" },
    { "language": "Romanian (Romania)", "code": "ro-RO" }, { "language": "Bengali (Bangladesh)", "code": "bn-BD" },
    { "language": "Marathi (India)", "code": "mr-IN" }, { "language": "Telugu (India)", "code": "te-IN" }
];
const VALID_LANGUAGE_CODES = AVAILABLE_LANGUAGES.map(lang => lang.code);

const AVAILABLE_VOICES = [
    { "voice": "Zephyr", "style": "Bright" }, { "voice": "Kore", "style": "Firm" }, { "voice": "Orus", "style": "Firm" },
    { "voice": "Autonoe", "style": "Bright" }, { "voice": "Umbriel", "style": "Easy-going" }, { "voice": "Erinome", "style": "Clear" },
    { "voice": "Laomedeia", "style": "Upbeat" }, { "voice": "Schedar", "style": "Even" }, { "voice": "Achird", "style": "Friendly" },
    { "voice": "Sadachbia", "style": "Lively" }, { "voice": "Puck", "style": "Upbeat" }, { "voice": "Fenrir", "style": "Excitable" },
    { "voice": "Aoede", "style": "Breezy" }, { "voice": "Enceladus", "style": "Breathy" }, { "voice": "Algieba", "style": "Smooth" },
    { "voice": "Algenib", "style": "Gravelly" }, { "voice": "Achernar", "style": "Soft" }, { "voice": "Gacrux", "style": "Mature" },
    { "voice": "Zubenelgenubi", "style": "Casual" }, { "voice": "Sadaltager", "style": "Knowledgeable" }, { "voice": "Charon", "style": "Informative" },
    { "voice": "Leda", "style": "Youthful" }, { "voice": "Callirrhoe", "style": "Easy-going" }, { "voice": "Iapetus", "style": "Clear" },
    { "voice": "Despina", "style": "Smooth" }, { "voice": "Rasalgethi", "style": "Informative" }, { "voice": "Alnilam", "style": "Firm" },
    { "voice": "Pulcherrima", "style": "Forward" }, { "voice": "Vindemiatrix", "style": "Gentle" }, { "voice": "Sulafat", "style": "Warm" }
];


// --- Funções Auxiliares ---
function convertToWav(rawData, mimeType) {
    const audioDataBuffer = Buffer.from(rawData, 'base64');
    const options = parseMimeType(mimeType);
    const wavHeader = createWavHeader(audioDataBuffer.length, options);
    return Buffer.concat([wavHeader, audioDataBuffer]);
}

function parseMimeType(mimeType) {
    const [fileType, ...params] = (mimeType || 'audio/L16;rate=24000').split(';').map(s => s.trim());
    const [_, format] = fileType.split('/');
    const options = { numChannels: 1, bitsPerSample: 16, sampleRate: 24000 };
    if (format && format.toUpperCase().startsWith('L')) {
        const bits = parseInt(format.slice(1), 10);
        if (!isNaN(bits)) options.bitsPerSample = bits;
    }
    for (const param of params) {
        const [key, value] = param.split('=').map(s => s.trim());
        if (key.toLowerCase() === 'rate' && !isNaN(parseInt(value, 10))) {
            options.sampleRate = parseInt(value, 10);
        }
    }
    return options;
}

function createWavHeader(dataLength, options) {
    const { numChannels, sampleRate, bitsPerSample } = options;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const buffer = Buffer.alloc(44);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataLength, 40);
    return buffer;
}

// --- Função para construir o payload correto ---
function buildGeminiTTSPayload(requestBody) {
    // Payload padrão seguindo o formato do curl que funciona
    const payload = {
        contents: [{
            parts: [{
                text: requestBody.text || requestBody.contents?.[0]?.parts?.[0]?.text || "Texto não fornecido"
            }]
        }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: requestBody.voice || 
                                  requestBody.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName ||
                                  "Leda" // voz padrão
                    }
                }
            }
        }
    };

    // Adiciona languageCode se fornecido
    if (requestBody.languageCode || requestBody.generationConfig?.speechConfig?.languageCode) {
        payload.generationConfig.speechConfig.languageCode = 
            requestBody.languageCode || requestBody.generationConfig.speechConfig.languageCode;
    }

    // Adiciona outras configurações se fornecidas
    if (requestBody.generationConfig?.speechConfig?.audioConfig) {
        payload.generationConfig.speechConfig.audioConfig = requestBody.generationConfig.speechConfig.audioConfig;
    }

    return payload;
}


// --- Endpoints da API ---
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/languages', (req, res) => res.status(200).json(AVAILABLE_LANGUAGES));
app.get('/voices', (req, res) => res.status(200).json(AVAILABLE_VOICES));

app.post('/test-proxy', async (req, res) => {
    console.log('[LOG] Recebida requisição em /test-proxy.');
    const proxyUrl = req.headers.proxy_url;
    if (!proxyUrl) {
        return res.status(400).json({ error: 'Header `proxy_url` é obrigatório.' });
    }
    let httpsAgent;
    try {
        const parsedUrl = new URL(proxyUrl);
        const protocol = parsedUrl.protocol.toLowerCase();
        if (protocol.startsWith('socks')) httpsAgent = new SocksProxyAgent(proxyUrl);
        else if (protocol.startsWith('http')) httpsAgent = new HttpsProxyAgent(proxyUrl);
        else throw new Error(`Protocolo de proxy não suportado: ${protocol}`);
    } catch (error) {
        return res.status(400).json({ error: 'Formato ou protocolo do header `proxy_url` inválido.', details: error.message });
    }
    try {
        console.log('[LOG] Enviando requisição de teste via proxy para ipinfo.io...');
        const proxyTestResponse = await axios.get('https://ipinfo.io/json', { httpsAgent, proxy: false, timeout: 15000 });
        console.log('[LOG] Teste de proxy bem-sucedido.');
        res.status(200).json({ message: 'A conexão com o proxy foi bem-sucedida.', proxyInfo: proxyTestResponse.data });
    } catch (error) {
        const errorMessage = error.response ? error.response.data : error.message;
        console.error('[ERROR] Falha ao testar a conexão com o proxy:', errorMessage);
        res.status(500).json({ error: 'Falha ao conectar através do proxy.', details: errorMessage });
    }
});

app.post('/generate-audio', async (req, res) => {
    console.log('[LOG] Recebida requisição em /generate-audio.');

    const geminiApiKey = req.query.key;
    if (!geminiApiKey) {
        return res.status(401).json({ error: 'A chave da API do Gemini (parâmetro `key`) é obrigatória.' });
    }

    // Constrói o payload no formato correto
    let payload = buildGeminiTTSPayload(req.body);
    console.log('[LOG] Payload construído:', JSON.stringify(payload, null, 2));

    try {
        const userLanguageCode = payload.generationConfig?.speechConfig?.languageCode;
        if (userLanguageCode && !VALID_LANGUAGE_CODES.includes(userLanguageCode)) {
            console.log(`[LOG][IA] Código de idioma '${userLanguageCode}' é inválido. Tentando corrigir...`);
            const prompt = `From the user input "${userLanguageCode}", what is the most likely correct language code from this list: ${JSON.stringify(VALID_LANGUAGE_CODES)}? Respond with ONLY the correct code string (e.g., "pt-BR") and nothing else! If no clear match is found, respond with "null".`;
            const correctionPayload = { contents: [{ parts: [{ text: prompt }] }] };
            const correctionConfig = { headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey } };
            const correctionResponse = await axios.post(GEMINI_TEXT_API_URL, correctionPayload, correctionConfig);
            const correctedCode = correctionResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (correctedCode && VALID_LANGUAGE_CODES.includes(correctedCode)) {
                console.log(`[LOG][IA] Código de idioma corrigido de '${userLanguageCode}' para '${correctedCode}'.`);
                payload.generationConfig.speechConfig.languageCode = correctedCode;
            } else {
                console.warn(`[WARN][IA] Não foi possível corrigir o código de idioma. Usando o valor original: '${userLanguageCode}'.`);
            }
        }
    } catch (error) {
        console.error('[ERROR][IA] Falha durante a tentativa de correção do código de idioma. O processo continuará com o código original.', error.message);
    }

    const proxyUrl = req.headers.proxy_url;
    let httpsAgent;
    const axiosConfig = {
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
        responseType: 'json',
    };

    if (proxyUrl) {
        try {
            const parsedUrl = new URL(proxyUrl);
            const protocol = parsedUrl.protocol.toLowerCase();
            if (protocol.startsWith('socks')) httpsAgent = new SocksProxyAgent(proxyUrl);
            else if (protocol.startsWith('http')) httpsAgent = new HttpsProxyAgent(proxyUrl);
            else throw new Error(`Protocolo de proxy não suportado: ${protocol}`);
            axiosConfig.httpsAgent = httpsAgent;
            axiosConfig.proxy = false;
        } catch (error) {
            return res.status(400).json({ error: 'Formato ou protocolo do header `proxy_url` inválido.', details: error.message });
        }
    }

    try {
        console.log('[LOG] Enviando requisição para a API do Gemini TTS...');
        const response = await axios.post(GEMINI_TTS_API_URL, payload, axiosConfig);
        const responseData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        const audioData = responseData?.candidates?.[0]?.content?.parts?.[0]?.inlineData;

        if (audioData?.data) {
            const wavBuffer = convertToWav(audioData.data, audioData.mimeType);
            
            // --- NOVA FUNCIONALIDADE: Salvar arquivo em disco ---
            const saveToPath = req.headers.save_to_path;
            const fileName = req.headers.file_name;

            if (saveToPath && fileName) {
                console.log(`[LOG] Requisição para salvar arquivo recebida. Caminho: ${saveToPath}, Nome: ${fileName}`);
                try {
                    // Garante que a extensão .wav esteja presente
                    const finalFileName = fileName.endsWith('.wav') ? fileName : `${fileName}.wav`;
                    const fullPath = path.join(saveToPath, finalFileName);

                    // Cria o diretório recursivamente se ele não existir
                    await fs.mkdir(path.dirname(fullPath), { recursive: true });
                    
                    // Salva o arquivo
                    await fs.writeFile(fullPath, wavBuffer);
                    
                    console.log(`[LOG] Áudio salvo com sucesso em: ${fullPath}`);
                    res.status(200).json({
                        success: true,
                        message: 'Áudio salvo com sucesso no caminho especificado.',
                        filePath: fullPath
                    });
                } catch (fileError) {
                    console.error('[ERROR] Falha ao salvar o arquivo de áudio:', fileError);
                    res.status(500).json({
                        error: 'Falha ao salvar o arquivo de áudio no servidor.',
                        details: fileError.message
                    });
                }
            } else {
                // Comportamento antigo: retorna o arquivo na resposta
                res.setHeader('Content-Type', 'audio/wav');
                res.setHeader('Content-Disposition', 'attachment; filename="audio.wav"');
                res.status(200).send(wavBuffer);
                console.log('[LOG] Arquivo de áudio .wav enviado com sucesso na resposta.');
            }
            // --- Fim da Funcionalidade de Salvar ---

        } else {
            console.error('[ERROR] Resposta da API do Gemini inválida.', JSON.stringify(responseData, null, 2));
            res.status(500).json({ error: 'A resposta da API do Gemini não continha dados de áudio válidos.', geminiResponse: responseData });
        }
    } catch (error) {
        const errorData = error.response ? error.response.data : { message: error.message };
        console.error('[ERROR] Erro ao chamar a API do Gemini:', JSON.stringify(errorData, null, 2));
        res.status(error.response?.status || 500).json({ error: 'Ocorreu um erro ao chamar a API do Gemini.', details: errorData.error || errorData });
    }
});

app.listen(PORT, () => {
    console.log(`[LOG] Servidor da API Gemini TTS Proxy iniciado na porta ${PORT}`);
    console.log(`  -> Funcionalidade de salvar em disco ATIVA!`);
    console.log(`  -> Funcionalidade de IA para correção de idioma ATIVA!`);
    console.log(`  - Endpoints disponíveis: /health, /voices, /languages, /generate-audio, /test-proxy`);
});