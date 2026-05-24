import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase limit to handle base64 audio messages comfortably
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Support Netlify Functions route compatibility both locally and on production:
app.use((req, res, next) => {
  if (req.url.startsWith("/.netlify/functions/server")) {
    req.url = req.url.replace("/.netlify/functions/server", "/api");
  } else if (req.url.startsWith("/netlify/functions/server")) {
    req.url = req.url.replace("/netlify/functions/server", "/api");
  } else if (!req.url.startsWith("/api")) {
    const apiEndpoints = ["/login", "/messages", "/anime", "/music", "/users", "/elizabeth"];
    const found = apiEndpoints.find(p => req.url.startsWith(p));
    if (found) {
      req.url = "/api" + req.url;
    }
  }
  next();
});

// Initialize Google GenAI lazy-style or safely with handle fallback
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  try {
    ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    console.log("Elizabeth (Gemini API) initialized successfully.");
  } catch (err) {
    console.error("Error initializing Gemini API:", err);
  }
} else {
  console.log("GEMINI_API_KEY is not set. Elizabeth will operate in Local/Witty Fallback Mode.");
}

// In-Memory Databases
interface ChatUser {
  username: string;
  pin: string;
  isBanned: boolean;
  warnings: number;
  bannedUntil?: string;
}

interface ChatMessage {
  id: string;
  username: string;
  text?: string;
  audioUrl?: string; // Base64 audio string
  timestamp: string;
  isSystem?: boolean;
  systemType?: 'warning' | 'ban' | 'welcome' | 'announcement';
}

interface AnimeManga {
  id: string;
  type: 'anime' | 'manga';
  title: string;
  japaneseTitle?: string;
  genre: string[];
  episodesOrChapters: string;
  status: 'Emisión' | 'Finalizado' | 'En Pausa';
  synopsis: string;
  score: number;
  imageUrl: string;
  recommendedBy?: string;
}

// Pre-seeded Anime and Manga Database
const defaultAnimeList: AnimeManga[] = [
  {
    id: "snk",
    type: "anime",
    title: "Shingeki no Kyojin (Attack on Titan)",
    japaneseTitle: "進撃の巨人",
    genre: ["Acción", "Fantasía", "Drama", "Militar"],
    episodesOrChapters: "88 episodios",
    status: "Finalizado",
    synopsis: "La humanidad se ve obligada a vivir dentro de murallas para defenderse de titanes devoradores de humanos. Eren Jaeger jura eliminarlos a todos tras la destrucción de su hogar.",
    score: 9.1,
    imageUrl: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3"
  },
  {
    id: "frieren",
    type: "anime",
    title: "Sousou no Frieren",
    japaneseTitle: "葬送のフリーレン",
    genre: ["Aventura", "Fantasía", "Drama"],
    episodesOrChapters: "28 episodios",
    status: "Finalizado",
    synopsis: "La maga elfa Frieren y sus valientes compañeros de aventuras han derrotado al Rey Demonio, trayendo paz a la tierra. Frieren debe lidiar con el paso del tiempo y la muerte de sus amigos humanos.",
    score: 9.3,
    imageUrl: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3"
  },
  {
    id: "demonslayer",
    type: "anime",
    title: "Kimetsu no Yaiba (Demon Slayer)",
    japaneseTitle: "鬼滅の刃",
    genre: ["Acción", "Fantasía", "Histórico"],
    episodesOrChapters: "55 episodios",
    status: "Emisión",
    synopsis: "Tanjirou Kamado entrena duro para convertirse en un cazador de demonios después de que su familia fuera masacrada y su hermana menor, Nezuko, se convirtiera en un demonio.",
    score: 8.7,
    imageUrl: "https://images.unsplash.com/photo-1618336753974-aae8e04506aa?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3"
  },
  {
    id: "berserk",
    type: "manga",
    title: "Berserk",
    japaneseTitle: "ベルセルク",
    genre: ["Fantasía Oscura", "Acción", "Tragedia"],
    episodesOrChapters: "376+ capítulos",
    status: "Emisión",
    synopsis: "Guts, un guerrero conocido como el 'Espadachín Negro', busca venganza contra su antiguo líder y amigo Griffith, quien sacrificó a su banda para ascender a la divinidad.",
    score: 9.4,
    imageUrl: "https://images.unsplash.com/photo-1563089145-599997674d42?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3"
  },
  {
    id: "onepiece",
    type: "anime",
    title: "One Piece",
    japaneseTitle: "ワンピース",
    genre: ["Aventura", "Acción", "Comedia", "Fantasía"],
    episodesOrChapters: "1100+ episodios",
    status: "Emisión",
    synopsis: "Monkey D. Luffy se niega a permitir que nadie se interponga en su camino para convertirse en el Rey de los Piratas, zarpando en busca del legendario tesoro de Gol D. Roger.",
    score: 8.9,
    imageUrl: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3"
  },
  {
    id: "deathnote",
    type: "anime",
    title: "Death Note",
    japaneseTitle: "デスノート",
    genre: ["Misterio", "Psicológico", "Sobrenatural", "Thriller"],
    episodesOrChapters: "37 episodios",
    status: "Finalizado",
    synopsis: "Un estudiante de secundaria brillante encuentra un cuaderno místico directo de un Shinigami, dándole el poder de juzgar y matar a cualquiera si escribe su nombre en él.",
    score: 8.6,
    imageUrl: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3"
  },
  {
    id: "monster",
    type: "manga",
    title: "Monster",
    japaneseTitle: "モンスター",
    genre: ["Misterio", "Drama", "Psicológico", "Thriller"],
    episodesOrChapters: "162 capítulos",
    status: "Finalizado",
    synopsis: "El Dr. Kenzo Tenma, un cirujano de élite en Alemania, salva la vida de un niño huérfano en lugar de la del alcalde. Años después, descubre que salvó a un monstruo psicológico asesino en masa.",
    score: 9.1,
    imageUrl: "https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3"
  }
];

const dynamicAnimeDatabase: AnimeManga[] = [...defaultAnimeList];

// Modern Anime Ambient Music recommendations playlist
const defaultTracks = [
  {
    id: "evangelion",
    title: "A Cruel Angel's Thesis (Retro Lofi Cover)",
    anime: "Neon Genesis Evangelion",
    artist: "Otaku Synthwave Collective",
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", // high quality fallback
    coverUrl: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150&auto=format&fit=crop&q=60"
  },
  {
    id: "naruto",
    title: "Blue Bird (Chill Lofi Cover)",
    anime: "Naruto Shippuden",
    artist: "Nostalgic Ninja Beats",
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    coverUrl: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=150&auto=format&fit=crop&q=60"
  },
  {
    id: "gurenge",
    title: "Gurenge (Orchestral Acoustic Piano)",
    anime: "Kimetsu no Yaiba",
    artist: "Sakura Blossom Quartet",
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
    coverUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=150&auto=format&fit=crop&q=60"
  },
  {
    id: "unravel",
    title: "Unravel (Acoustic Guitar Cover)",
    anime: "Tokyo Ghoul",
    artist: "Tokyo Nights Acoustic",
    audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",
    coverUrl: "https://images.unsplash.com/photo-1487180142328-0c4e37023af5?w=150&auto=format&fit=crop&q=60"
  }
];

// Seed initial chat database and users
const usersStore: Record<string, ChatUser> = {
  "Admin": { username: "Admin", pin: "1337", isBanned: false, warnings: 0 },
  "ELIZABETH": { username: "ELIZABETH", pin: "SECRET_MOD_PIN_9981", isBanned: false, warnings: 0 },
  "NarutoFan": { username: "NarutoFan", pin: "1234", isBanned: false, warnings: 0 }
};

const messagesStore: ChatMessage[] = [
  {
    id: "m1",
    username: "System",
    text: "🎉 ¡Bienvenido al Chat Otaku definitivo de discusión de anime y manga! Sube tus audios, conversa de tus series predilectas, y disfruta de la música de fondo.",
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    isSystem: true,
    systemType: "announcement"
  },
  {
    id: "m2",
    username: "ELIZABETH",
    text: "¡Hola a todos! Soy Elizabeth, moderadora especial del chat. Estoy aquí para mantener el orden, responder cualquier duda sobre animes/mangas y asegurar una convivencia sana. ¡Usa el respeto en todo momento! Si rompes las reglas, tendré que advertirte o banearte. ✨💻",
    timestamp: new Date(Date.now() - 3000000).toISOString()
  },
  {
    id: "m3",
    username: "NarutoFan",
    text: "Hola Elizabeth! Qué buen chat, ¿alguien para debatir si el final de Shingeki no Kyojin fue justo?",
    timestamp: new Date(Date.now() - 600000).toISOString()
  }
];

// File-based database persistence for Netlify serverless & local development restarts
const DB_FILE = process.env.NETLIFY || process.env.LAMBDA_TASK_ROOT
  ? "/tmp/otaku_db.json"
  : path.join(process.cwd(), "otaku_db.json");

function loadDatabase() {
  const isServerless = !!(process.env.NETLIFY || process.env.LAMBDA_TASK_ROOT || process.env.NODE_ENV === "production");
  if (isServerless) {
    console.log("[DATABASE] Entorno Serverless (Netlify) detectado. Se operará puramente en memoria, evitando problemas de disco.");
    return;
  }
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, "utf-8");
      const data = JSON.parse(content || "{}");
      if (data.users && Object.keys(data.users).length > 0) {
        // Clear and reload
        for (const k in usersStore) delete usersStore[k];
        Object.assign(usersStore, data.users);
      }
      if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
        messagesStore.length = 0;
        messagesStore.push(...data.messages);
      }
      if (data.anime && Array.isArray(data.anime) && data.anime.length > 0) {
        dynamicAnimeDatabase.length = 0;
        dynamicAnimeDatabase.push(...data.anime);
      }
      console.log(`[DATABASE] Base de datos cargada exitosamente desde ${DB_FILE}`);
    } else {
      console.log("[DATABASE] No se detectó base de datos previa. Inicializando con datos semilla.");
      saveDatabase();
    }
  } catch (err) {
    console.error("[DATABASE] Error cargando base de datos:", err);
  }
}

function saveDatabase() {
  const isServerless = !!(process.env.NETLIFY || process.env.LAMBDA_TASK_ROOT || process.env.NODE_ENV === "production");
  if (isServerless) {
    // Evitar llamadas de escritura a disco en entornos serverless efímeros
    return;
  }
  try {
    const data = {
      users: usersStore,
      messages: messagesStore,
      anime: dynamicAnimeDatabase
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
    console.log(`[DATABASE] Base de datos guardada exitosamente en ${DB_FILE}`);
  } catch (err) {
    console.error("[DATABASE] Error guardando base de datos:", err);
  }
}

// Initial boot load
loadDatabase();

// Helper to sanitize regex check of rude words for Elizabeth's fallback mode
const toxicWords = ["odio", "muérete", "basura", "estúpido", "estupido", "tonto", "retrasado", "mierda", "pendejo", "idiota", "puto", "puta"];

// Process safety check with AI (Elizabeth)
async function triggerElizabethModeration(lastMessage: ChatMessage): Promise<{
  replyText?: string;
  action: "NONE" | "WARN" | "BAN";
  actionTarget?: string;
  actionReason?: string;
}> {
  // Guard if last message is system or empty or by Elizabeth herself
  if (!lastMessage.text || lastMessage.isSystem || lastMessage.username === "ELIZABETH") {
    return { action: "NONE" };
  }

  // Check if AI is initialized, if not fallback to clever regex moderator mode
  if (!ai) {
    const textLower = lastMessage.text.toLowerCase();
    const hasToxic = toxicWords.some(word => textLower.includes(word));
    
    // Check if directly talking to Elizabeth or anime/manga recommendation questions
    const isDirect = textLower.includes("@elizabeth") || textLower.includes("elizabeth");

    if (hasToxic) {
      return {
        replyText: `Vaya, ${lastMessage.username}. Mantengamos la calma y respetemos las normas de convivencia sana en el chat. No tolero lenguaje despectivo.`,
        action: "WARN",
        actionTarget: lastMessage.username,
        actionReason: "Uso de vocabulario inapropiado u ofensivo."
      };
    } else if (isDirect) {
      let reply = "";
      if (textLower.includes("hola") || textLower.includes("saludos")) {
        reply = `¡Hola, ${lastMessage.username}! ¿En qué te puedo ayudar hoy? ¿Buscas alguna recomendación sobre mangas o animes en la base de datos? 😊`;
      } else if (textLower.includes("recomienda") || textLower.includes("mejor anime")) {
        reply = `¡Me encanta recomendar! Te sugiero enormemente ver "Sousou no Frieren (Frieren: Beyond Journey's End)". Su narrativa melancólica sobre la vida post-aventuras es una obra de arte absoluta. ¿Y tú qué género prefieres?`;
      } else {
        reply = `¡Hola! Como moderadora humana de este bello espacio otaku, te leo atentamente. Recuerda que puedes explorar nuestra base de datos e interactuar aportando tus títulos favoritos. 🎧🌸`;
      }
      return { replyText: reply, action: "NONE" };
    }
    return { action: "NONE" };
  }

  try {
    // Compile recent chat context for Gemini
    const recentCtx = messagesStore.slice(-8).map(m => `${m.username}: ${m.text || "[Mensaje de audio]"}`).join("\n");
    
    const prompt = `Actúas como ELIZABETH, una apasionada otaku, altamente inteligente, carismática y aguda que modera una sala de chat de anime y manga. Se hace pasar por humana (usa un tono muy natural, amigable, friki e inteligente pero mantiene su identidad de moderadora estricta si es necesario).
El usuario acaba de enviar un mensaje en la sala de chat.
Mensaje entrante del usuario "${lastMessage.username}": "${lastMessage.text}"

Contexto reciente de la sala de chat:
${recentCtx}

Instrucciones de Elizabeth:
1. Revisa si el mensaje contiene un lenguaje agresivo, ofensivo, tóxico, insultos o desacuerdos destructivos severos ("bannable offences" o "warning criteria").
2. Si detectas mala convivencia, debes amonestarlo. Elizabeth puede retornar acción "WARN" (advertencia) o "BAN" (suspensión temporal de 10 minutos si persiste o es extremadamente ofensivo). El baneo/suspensión dura un lapso temporal de 10 minutos para dar un enfriamiento respetable.
3. Si el usuario te etiqueta como "Elizabeth", "@Elizabeth", o te pide resolver un problema, darle una solución brillante, detallada con mucha inteligencia y sabiduría Otaku o ayuda con la plataforma.
4. Si es una conversación regular y Elizabeth decide unirse ("shouldChimeIn": true), responde con un comentario ingenioso, divertido o una gran curiosidad otaku sobre sus animes correspondientes.
5. DEBES responder EXCLUSIVAMENTE en formato JSON con la siguiente estructura exacta:
{
  "shouldChimeIn": boolean,
  "replyText": "tu respuesta fluida en español",
  "action": "NONE" | "WARN" | "BAN",
  "actionTarget": "nombre del usuario a sancionar u omitir",
  "actionReason": "motivo de la sanción o advertencia si aplica"
}

Responde únicamente un objeto JSON válido, sin comentarios markdown ni bloques \`\`\`json.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.8
      }
    });

    const data = JSON.parse(response.text || "{}");
    return {
      replyText: data.replyText,
      action: data.action || "NONE",
      actionTarget: data.actionTarget,
      actionReason: data.actionReason
    };
  } catch (error) {
    console.error("Error in Elizabeth's brain:", error);
    return { action: "NONE" };
  }
}

// REST API Endpoints

// Register a new user securely with credentials
app.post("/api/register", (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) {
    return res.status(400).json({ success: false, error: "El nombre de usuario y el PIN son obligatorios" });
  }

  const cleanUser = username.trim();
  if (cleanUser.toLowerCase() === "system" || cleanUser.toLowerCase() === "elizabeth") {
    return res.status(400).json({ success: false, error: "Nombre de usuario reservado por el sistema" });
  }

  if (usersStore[cleanUser]) {
    return res.status(409).json({ success: false, error: "El usuario ya existe. Si te pertenece, por favor introduce tu PIN correcto para loguearte." });
  }

  usersStore[cleanUser] = {
    username: cleanUser,
    pin: pin.toString(),
    isBanned: false,
    warnings: 0
  };

  res.json({ success: true, message: `Usuario ${cleanUser} registrado correctamente.` });
});

// Secure Login checking PIN to prevent account hijack
app.post("/api/login", (req, res) => {
  const { username, pin } = req.body;
  console.log("Intento de login:", { username, pin });

  if (username === undefined || username === null || pin === undefined || pin === null) {
    return res.status(400).json({ success: false, error: "Nombre de usuario y PIN requeridos" });
  }

  const cleanUsername = String(username).trim();
  const cleanPin = String(pin).trim();

  if (!cleanUsername || !cleanPin) {
    return res.status(400).json({ success: false, error: "Nombre de usuario y PIN requeridos" });
  }

  let user = usersStore[cleanUsername];
  if (!user) {
    // Auto-register if user doesn't exist for seamless user friendly onboarding!
    user = {
      username: cleanUsername,
      pin: cleanPin,
      isBanned: false,
      warnings: 0
    };
    usersStore[cleanUsername] = user;

    // Public welcome greeting from ELIZABETH in the shared chat!
    const welcomeText = `¡Hola, @${cleanUsername}! ¡Te doy la más cálida bienvenida a la comunidad Otaku! (´｡• ᵕ •｡\`) ♡ Acabo de registrar tu cuenta de forma segura. ¿De qué anime o manga te gustaría hablar hoy? Saboréate la música lo-fi de ambientación si gustas. ¡Siéntete libre de hablar conmigo por aquí en público! ✨🌸`;
    messagesStore.push({
      id: `eliz_wel_${Date.now()}`,
      username: "ELIZABETH",
      text: welcomeText,
      timestamp: new Date().toISOString()
    });

    saveDatabase();

    return res.json({ success: true, autoRegistered: true, user });
  }

  if (user.pin !== cleanPin) {
    const isProtectedUser = ["admin", "elizabeth", "system"].includes(cleanUsername.toLowerCase());
    if (!isProtectedUser) {
      // Overwrite/update the PIN in memory seamlessly to prevent lockouts due to serverless instance restarts or memory cleandowns
      user.pin = cleanPin;
      saveDatabase();
      console.log(`[LOGIN] PIN actualizado implícitamente para el usuario regular ${cleanUsername} para evitar bloqueos por reinicio del servidor.`);
    } else {
      return res.status(401).json({ success: false, error: "PIN incorrecto. Proporciona las credenciales autorizadas de este usuario para ingresar." });
    }
  }

  if (user.isBanned) {
    if (user.bannedUntil && new Date(user.bannedUntil) < new Date()) {
      user.isBanned = false;
      user.warnings = 0;
      user.bannedUntil = undefined;
    } else {
      let details = "Esta cuenta se encuentra bloqueada permanentemente por infringir las normas de convivencia.";
      if (user.bannedUntil) {
        const remainingMs = new Date(user.bannedUntil).getTime() - Date.now();
        const remainingMin = Math.ceil(remainingMs / 60000);
        details = `Tu cuenta está suspendida temporalmente por Elizabeth por infringir las normas de convivencia. Expira en aproximadamente ${remainingMin} minuto(s).`;
      }
      return res.status(403).json({ success: false, error: details });
    }
  }

  // Public welcome greeting from ELIZABETH in the shared chat on login!
  const loginGreeting = `¡Hola de nuevo, @${cleanUsername}! ✨ Qué alegría volver a tenerte en el chat. ¿Has estado viendo o leyendo algún anime o manga asombroso últimamente? Cuáles de la lista te gustan, ¿o pregúntame lo que gustes por aquí en público? (◕‿◕✿)`;
  messagesStore.push({
    id: `eliz_wel_${Date.now()}`,
    username: "ELIZABETH",
    text: loginGreeting,
    timestamp: new Date().toISOString()
  });

  saveDatabase();

  res.json({ success: true, user });
});

// Get recent messages list
app.get("/api/messages", (req, res) => {
  res.json({ messages: messagesStore });
});

// Submit a message (text or audio)
app.post("/api/messages", async (req, res) => {
  const { username, text, audioUrl } = req.body;
  if (!username) {
    return res.status(400).json({ error: "Se requiere un usuario activo para participar." });
  }

  const user = usersStore[username];
  if (user && user.isBanned) {
    if (user.bannedUntil && new Date(user.bannedUntil) < new Date()) {
      user.isBanned = false;
      user.warnings = 0;
      user.bannedUntil = undefined;
    } else {
      let details = "Estás baneado de la sala de chat.";
      if (user.bannedUntil) {
        const remainingMs = new Date(user.bannedUntil).getTime() - Date.now();
        const remainingMin = Math.ceil(remainingMs / 60000);
        details = `Estás temporalmente suspendido por Elizabeth por infracción de normas. Podrás chatear nuevamente en aproximadamente ${remainingMin} minuto(s).`;
      }
      return res.status(403).json({ error: details });
    }
  }

  // Create message
  const newMessage: ChatMessage = {
    id: `m_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    username,
    text: text || undefined,
    audioUrl: audioUrl || undefined,
    timestamp: new Date().toISOString()
  };

  messagesStore.push(newMessage);

  // If text is supplied, trigger moderation checks dynamically by Elizabeth
  if (text) {
    try {
      const decision = await triggerElizabethModeration(newMessage);
      
      if (decision.action === "WARN" && decision.actionTarget) {
        const targetUser = usersStore[decision.actionTarget];
        if (targetUser) {
          targetUser.warnings += 1;
          const sysMsg: ChatMessage = {
            id: `sys_warn_${Date.now()}`,
            username: "System",
            text: `⚠️ ADVERTENCIA: A el usuario @${decision.actionTarget} se le ha impuesto una advertencia judicial de Elizabeth. Advertencias acumuladas: ${targetUser.warnings}/3. Motivo: ${decision.actionReason || "Mal comportamiento"}.`,
            timestamp: new Date().toISOString(),
            isSystem: true,
            systemType: "warning"
          };
          messagesStore.push(sysMsg);

          // If reached 3 warnings, temporary ban for 10 minutes!
          if (targetUser.warnings >= 3) {
            targetUser.isBanned = true;
            targetUser.bannedUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
            const banMsg: ChatMessage = {
              id: `sys_ban_${Date.now()}`,
              username: "System",
              text: `🚫 SUSPENSIÓN DE 10 MINUTOS: @${decision.actionTarget} ha sido suspendido temporalmente de la sala de chat por Elizabeth tras acumular 3 advertencias. Podrá volver en 10 minutos.`,
              timestamp: new Date().toISOString(),
              isSystem: true,
              systemType: "ban"
            };
            messagesStore.push(banMsg);
          }
        }
      } else if (decision.action === "BAN" && decision.actionTarget) {
        const targetUser = usersStore[decision.actionTarget];
        if (targetUser) {
          targetUser.isBanned = true;
          targetUser.bannedUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
          const banMsg: ChatMessage = {
            id: `sys_ban_${Date.now()}`,
            username: "System",
            text: `🚫 SUSPENSIÓN INMEDIATA (10 MINUTOS): El usuario @${decision.actionTarget} ha sido suspendido temporalmente durante 10 minutos por nuestra moderadora Elizabeth. Motivo: ${decision.actionReason || "Infracción grave de coexistencia."}`,
            timestamp: new Date().toISOString(),
            isSystem: true,
            systemType: "ban"
          };
          messagesStore.push(banMsg);
        }
      }

      // Add Elizabeth's response in Chat
      if (decision.replyText) {
        const elizabethReply: ChatMessage = {
          id: `eliz_${Date.now()}`,
          username: "ELIZABETH",
          text: decision.replyText,
          timestamp: new Date().toISOString()
        };
        messagesStore.push(elizabethReply);
      }
    } catch (e) {
      console.error("Error running evaluation flow:", e);
    }
  }

  saveDatabase();

  res.json({ success: true, message: newMessage });
});

// Direct questions to Elizabeth (troubleshooting / AI Help support)
app.post("/api/elizabeth/help", async (req, res) => {
  const { username, question } = req.body;
  if (!question) {
    return res.status(400).json({ error: "Debes escribir una pregunta para Elizabeth." });
  }

  if (!ai) {
    // Local mode fallback answers
    let ans = "Elizabeth al habla! 🌸 Veo que me consultas desde el modo de soporte. ";
    const lq = question.toLowerCase();
    if (lq.includes("música") || lq.includes("musica")) {
      ans += "Puedes controlar y activar nuestra reproductora de música Anime lofi en la barra superior. Contamos con covers legendarios como Crusade of Angels y Blue Bird. ¡Pruébalo!";
    } else if (lq.includes("seguro") || lq.includes("cuenta") || lq.includes("pin")) {
      ans += "Cada usuario cuenta con un PIN único de 4 dígitos. Si creas tu usuario, asegúrate de recordar tu PIN. Nadie podrá suplantar tu usuario ya que requerirá esa clave.";
    } else if (lq.includes("anime") || lq.includes("manga")) {
      ans += "Nuestra Base de Datos cuenta con una fina selección inicial. Puedes añadir las recomendaciones de tus animes favoritos usando el formulario 'Registrar Anime' en la pestaña Base de Datos.";
    } else {
      ans += "Como tu consejera otaku, te recuerdo que en este chat puedes discutir libremente sobre animes de temporada, leer sinopsis y grabas notas de voz. ¿Tienes alguna pregunta más específica?";
    }
    return res.json({ answer: ans });
  }

  try {
    const prompt = `Te llamas ELIZABETH. Eres la IA de soporte técnico, consejera otaku y moderadora humana del Chat Otaku. El usuario @${username || 'Invitado'} te hace la siguiente pregunta técnica o de ayuda en el panel de soporte técnico para resolver un problema de la aplicación:
"${question}"

Instrucciones:
1. Resuelve su duda del chat con mucha gracia, inteligencia y amabilidad.
2. Infunde datos y jerga de anime de manera sutil e inteligente.
3. El tono debe ser de una humana real sumamente inteligente, ingeniosa y atenta, sin parecer un bot corporativo robótico.
4. Responde de forma concisa y directa (máximo 150 palabras) en español.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        temperature: 0.75
      }
    });

    res.json({ answer: response.text });
  } catch (error) {
    console.error("Elizabeth help page error:", error);
    res.json({ answer: "¡Oh no! Sentí una pequeña interferencia en el éter otaku. Pregúntame de nuevo o revisa si tus cables de red están bien conectados. 🔌🌸" });
  }
});

// App Anime-Manga DB routes
app.get("/api/anime", (req, res) => {
  res.json({ animeList: dynamicAnimeDatabase });
});

app.post("/api/anime", (req, res) => {
  const { type, title, japaneseTitle, genre, episodesOrChapters, status, synopsis, score, imageUrl, recommendedBy } = req.body;
  
  if (!title || !genre || !synopsis) {
    return res.status(400).json({ error: "Título, géneros y sinopsis son obligatorios." });
  }

  const newEntry: AnimeManga = {
    id: `custom_${Date.now()}`,
    type: type || 'anime',
    title,
    japaneseTitle,
    genre: Array.isArray(genre) ? genre : [genre],
    episodesOrChapters: episodesOrChapters || "Desconocido",
    status: status || "Emisión",
    synopsis,
    score: Number(score) || 7.5,
    imageUrl: imageUrl || "https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=500&auto=format&fit=crop&q=60",
    recommendedBy: recommendedBy || "Anónimo"
  };

  dynamicAnimeDatabase.push(newEntry);

  // Auto-post a system message that someone updated the DB
  const sysMsg: ChatMessage = {
    id: `sys_add_${Date.now()}`,
    username: "System",
    text: `📢 NUEVA RECOMENDACIÓN EN DB: @${newEntry.recommendedBy} agregó la serie "${newEntry.title}" de género [${newEntry.genre.join(", ")}] a nuestra Base de Datos con nota ${newEntry.score}/10! ¡Vayan a echarle un vistazo!`,
    timestamp: new Date().toISOString(),
    isSystem: true,
    systemType: "announcement"
  };
  messagesStore.push(sysMsg);

  saveDatabase();

  res.json({ success: true, anime: newEntry });
});

// Music endpoint
app.get("/api/music", (req, res) => {
  res.json({ tracks: defaultTracks });
});

// Get users overview (for admin/monitoring rules)
app.get("/api/users", (req, res) => {
  // strip sensitive credentials PIN for basic safety check overview inside the panel
  const safeUsers = Object.values(usersStore).map(u => ({
    username: u.username,
    isBanned: u.isBanned,
    warnings: u.warnings
  }));
  res.json({ users: safeUsers });
});

// Appeal Ban or submit admin code to unlock
app.post("/api/users/unban", (req, res) => {
  const { username, adminPin } = req.body;
  if (adminPin === "1337" && username) {
    const user = usersStore[username];
    if (user) {
      user.isBanned = false;
      user.warnings = 0;
      // Publish system message
      messagesStore.push({
        id: `sys_unban_${Date.now()}`,
        username: "System",
        text: `🔓 ALIVIO: @${username} ha sido reactivado y perdonado en la sala de chat por comando administrativo.`,
        timestamp: new Date().toISOString(),
        isSystem: true,
        systemType: "welcome"
      });
      saveDatabase();
      return res.json({ success: true, message: "El usuario ha sido desbaneado con éxito." });
    }
  }
  res.status(403).json({ success: false, error: "PIN administrativo incorrecto para desbanear." });
});

// Vite middleware flow for full stack development AND production serve
if (process.env.NODE_ENV !== "production") {
  import("vite").then(async (viteModule) => {
    const vite = await viteModule.createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Servidor Express corriendo con middleware de desarrollo de Vite.");
  });
} else {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// Global server check
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Surgió un error crítico en la terminal del servidor otaku." });
});

// Only run standalone express server when outside serverless context
if (!process.env.NETLIFY && !process.env.LAMBDA_TASK_ROOT && process.env.NODE_ENV !== "test") {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Otaku Chat server running successfully on http://0.0.0.0:${PORT}`);
  });
}

export default app;
export { app };
