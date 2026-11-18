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
    avisar_minutos_antes: { type: 'integer', description: 'Minutos antes para avisar; por defecto 15' },
  }, ['titulo', 'fecha']),
  fn('crear_recordatorio', 'Programa un recordatorio que sonará a esa fecha y hora.', {
    texto: { type: 'string' },
    fecha: { type: 'string', description: 'YYYY-MM-DD' },
    hora: { type: 'string', description: 'HH:MM en 24 h' },
  }, ['texto', 'fecha', 'hora']),
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
  fn('editar_elemento', 'Cambia título, fecha, hora o texto de un evento, tarea, nota o recordatorio que ya existe.', {
    tipo: { type: 'string', enum: ['evento', 'tarea', 'nota', 'recordatorio'] },
    buscar: { type: 'string', description: 'Parte del título actual' },
    nuevo_titulo: { type: 'string' },
    fecha: { type: 'string', description: 'YYYY-MM-DD' },
    hora: { type: 'string', description: 'HH:MM en 24 h' },
    texto: { type: 'string', description: 'Nuevo contenido, solo para notas' },
  }, ['tipo', 'buscar']),
  fn('completar_tarea', 'Marca una tarea como hecha (o como pendiente con hecha=false).', {
    buscar: { type: 'string', description: 'Parte del título de la tarea' },
    hecha: { type: 'boolean' },
  }, ['buscar']),
  fn('borrar_elemento', 'Borra un evento, tarea, nota o recordatorio.', {
    tipo: { type: 'string', enum: ['evento', 'tarea', 'nota', 'recordatorio'] },
    buscar: { type: 'string', description: 'Parte del título' },
  }, ['tipo', 'buscar']),
  fn('ver_agenda', 'Devuelve todos los eventos, tareas y notas guardados.', {}, []),
];

// Puedes cambiar el modelo sin tocar el código: variable GROQ_MODEL en Vercel.
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// Solo los últimos mensajes: menos tokens por minuto (el plan gratis tiene tope).
function recent(msgs) {
  const out = msgs.slice(-12);
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

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
      'Para cambiar, completar o borrar usa editar_elemento, completar_tarea o borrar_elemento con parte del título; si hay varios parecidos, pregunta cuál. Si piden un PDF, usa generar_pdf. Si piden que les recuerdes algo, usa crear_recordatorio y pregunta la hora si no la dieron. ' +
      'Si falta un dato imprescindible (por ejemplo, el día), pregúntalo en una sola frase.',
  };

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.GROQ_API_KEY },
      body: JSON.stringify({
        model: MODEL,
        messages: [system, ...recent(messages)],
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.3,
        max_completion_tokens: 800,
        ...(/gpt-oss/.test(MODEL) ? { reasoning_effort: 'low' } : {}),
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      let msg = (data.error && data.error.message) || 'Error de Groq';
      if (r.status === 429) {
        const m = /try again in ([\d.]+)s/i.exec(msg);
        return res.status(429).json({ error: 'Llegué al límite gratuito de Groq por minuto. Espera ' + (m ? Math.ceil(m[1]) + ' segundos' : 'unos segundos') + ' y vuelve a intentarlo.' });
      }
      if (/does not exist|do not have access|model_not_found/i.test(msg)) {
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