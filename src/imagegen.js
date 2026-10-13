// Concept renders via the OpenAI Images API, called straight from the browser with the user's own key.
const API = 'https://api.openai.com/v1/images';

export const STYLES = {
  'Built model photo': 'Studio product photo of a finished custom LEGO set built entirely from real, currently produced LEGO bricks: {idea}. Clean white seamless background, soft shadows, slightly elevated three-quarter view, sharp focus, realistic plastic sheen and visible studs. No minifigure faces distorted, no text.',
  'Retail box art': 'Official-looking LEGO retail box front for a custom set: {idea}. The built model is the hero, dynamic three-quarter view, bright colorful backdrop scene, room for a title at top left, realistic LEGO bricks with studs, professional product packaging design. Do not use the LEGO logo.',
  'Microscale': 'Small microscale LEGO build (under 150 pieces) of {idea}, made of plates, tiles and slopes, product photo on white background, realistic LEGO parts.',
  'Minifig vignette': 'Compact 8x8 stud LEGO vignette diorama of {idea}, with minifigures, realistic LEGO bricks, studio photo on white background.',
};

export function buildPrompt(style, idea, pieces) {
  return STYLES[style].replace('{idea}', idea.trim()) + (pieces ? ` Approximately ${pieces} pieces.` : '');
}

async function call(path, key, body, isForm) {
  const r = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, ...(isForm ? {} : { 'Content-Type': 'application/json' }) },
    body: isForm ? body : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('OpenAI rejected the API key. Check it under Image generator.');
  if (r.status === 429) throw new Error('OpenAI rate limit or quota reached. Wait a minute or check your billing.');
  if (!r.ok) throw new Error(j.error?.message || `Image API error ${r.status}`);
  return j.data.map((d) => d.b64_json ? 'data:image/png;base64,' + d.b64_json : d.url);
}

export function generate({ key, model, prompt, n = 2, size = '1536x1024', quality = 'medium' }) {
  return call('generations', key, { model, prompt, n, size, quality });
}

// Refine an existing concept: send it as the reference image with new instructions.
export async function refine({ key, model, prompt, image, n = 2, size = '1536x1024', quality = 'medium' }) {
  const blob = await (await fetch(image)).blob();
  const fd = new FormData();
  fd.append('model', model);
  fd.append('prompt', prompt);
  fd.append('n', String(n));
  fd.append('size', size);
  fd.append('quality', quality);
  fd.append('image[]', blob, 'concept.png');
  return call('edits', key, fd, true);
}
