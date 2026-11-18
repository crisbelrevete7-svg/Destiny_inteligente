// Vercel Serverless Function. La clave vive en Vercel (GROQ_API_KEY), nunca en el navegador.
const fn = (name, description, properties, required) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

const TOOLS = [
  fn('crear_evento', 'Agenda un evento o cita en el calendario.', {
    titulo: { type: 'string' },
    fecha: { type: 'string', description: 'YYYY-MM-DD' },
    hora: { type: 'string', description: 'HH:MM en 24 h, opcional' },
  }, ['titulo', 'fecha']),
  fn('crear_tarea', 'Crea una tarea pendiente.', {
    titulo: { type: 'string' },
    fecha_limite: { type: 'string', description: 'YYYY-MM-DD, opcional' },
  }, ['titulo']),
  fn('crear_nota', 'Guarda una nota.', {
    titulo: { type: 'string' },
    texto: { type: 'string' },
  }, ['titulo']),
  fn('generar_pdf', 'Genera y descarga un PDF con la agenda del usuario.', {
    contenido: { type: 'string', enum: ['todo', 'eventos', 'tareas', 'notas'], description: 'Qué incluir; por defecto todo' },
  }, []),
  fn('ver_agenda', 'Devuelve todos los eventos, tareas y notas guardados.', {}, []),
];

// Puedes cambiar el modelo sin tocar el código: variable GROQ_MODEL en Vercel.
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: 'Falta GROQ_API_KEY en Vercel' });

  const { messages = [], ahora = '' } = req.body || {};
  const system = {
    role: 'system',
    content:
      'Eres Destiny, asistente personal. Responde en español, breve y cálido. ' +
      'Para agendar eventos, crear tareas o notas, usa siempre las herramientas; no finjas haberlo hecho. ' +
      'Convierte fechas relativas ("mañana", "el viernes") a YYYY-MM-DD usando la fecha actual del usuario: ' + ahora + '. ' +
      'Si piden un PDF, usa generar_pdf. ' +
      'Si falta un dato imprescindible (por ejemplo, el día), pregúntalo en una sola frase.',
  };

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.GROQ_API_KEY },
      body: JSON.stringify({
        model: MODEL,
        messages: [system, ...messages.slice(-40)],
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.3,
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      let msg = (data.error && data.error.message) || 'Error de Groq';
      if (/model/i.test(msg)) {
        try {
          const l = await (await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY } })).json();
          msg += ' Modelos disponibles para tu clave: ' + l.data.map(m => m.id).join(', ') + '. Pon uno en GROQ_MODEL.';
        } catch {}
      }
      return res.status(502).json({ error: msg });
    }
    const m = data.choices[0].message;
    res.status(200).json({ message: { role: 'assistant', content: m.content || '', tool_calls: m.tool_calls } });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo contactar a Groq: ' + e.message });
  }
};