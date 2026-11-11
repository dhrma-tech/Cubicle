// Translates the chat format the app speaks (Gemini style: contents, functionDeclarations, functionCall) into
// OpenAI-compatible (OpenAI, Groq, OpenRouter, ...) and Anthropic requests, and maps the answers back.
// Files starting with an underscore are not served as routes by Vercel.

const lower = (s) => Array.isArray(s) ? s.map(lower)
  : s && typeof s === "object" ? Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === "type" && typeof v === "string" ? v.toLowerCase() : lower(v)]))
  : s;
const decls = (body) => (body.tools || []).flatMap((t) => t.functionDeclarations || []);
const sysText = (body) => (body.systemInstruction?.parts || []).map((p) => p.text || "").join("\n");

/** Neutral turns: { role:"model", text, calls:[{id,name,args}] } and { role:"user", text, results:[{id,name,response}] }. */
function turns(body) {
  const out = []; let n = 0; let open = [];
  for (const c of body.contents || []) {
    const parts = c.parts || [];
    if (c.role === "model") {
      const calls = parts.filter((p) => p.functionCall).map((p) => ({ id: `call_${n++}`, name: p.functionCall.name, args: p.functionCall.args || {} }));
      open = calls.map((x) => ({ id: x.id, name: x.name, used: false }));
      out.push({ role: "model", text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join(""), calls });
    } else {
      const results = [];
      for (const p of parts.filter((x) => x.functionResponse)) {
        const m = open.find((x) => !x.used && x.name === p.functionResponse.name);
        if (m) { m.used = true; results.push({ id: m.id, name: m.name, response: p.functionResponse.response ?? {} }); }
      }
      out.push({ role: "user", text: parts.filter((p) => p.text).map((p) => p.text).join("\n"), results });
    }
  }
  // every tool call needs a result right after it; calls at the very end (never answered) are dropped
  out.forEach((t, i) => {
    if (t.role !== "model" || !t.calls.length) return;
    const next = out[i + 1];
    if (!next || next.role !== "user") { t.calls = []; return; }
    for (const c of t.calls) if (!next.results.some((r) => r.id === c.id)) next.results.push({ id: c.id, name: c.name, response: { note: "no result" } });
  });
  return out;
}

const parseArgs = (s) => { try { return typeof s === "string" ? JSON.parse(s || "{}") : s || {}; } catch { return {}; } };
const wrap = (parts, blocked) => parts.length ? { candidates: [{ content: { role: "model", parts } }] } : { candidates: [], promptFeedback: blocked ? { blockReason: "OTHER" } : undefined };

/* ---------- OpenAI-compatible ---------- */
export function toOpenAI(body, model, maxTokens) {
  const messages = []; const sys = sysText(body);
  if (sys) messages.push({ role: "system", content: sys });
  for (const t of turns(body)) {
    if (t.role === "model") {
      const m = { role: "assistant", content: t.text || null };
      if (t.calls.length) m.tool_calls = t.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }));
      if (m.content || m.tool_calls) messages.push(m);
    } else {
      for (const r of t.results) messages.push({ role: "tool", tool_call_id: r.id, content: JSON.stringify(r.response) });
      if (t.text) messages.push({ role: "user", content: t.text });
    }
  }
  const tools = decls(body).map((d) => ({ type: "function", function: { name: d.name, description: d.description, parameters: lower(d.parameters || { type: "object", properties: {} }) } }));
  return { model, messages, ...(tools.length ? { tools, tool_choice: "auto" } : {}), temperature: 0.4, max_tokens: maxTokens };
}
export function fromOpenAI(j) {
  const m = j?.choices?.[0]?.message || {}; const parts = [];
  if (m.content) parts.push({ text: m.content });
  for (const c of m.tool_calls || []) parts.push({ functionCall: { name: c.function?.name, args: parseArgs(c.function?.arguments) } });
  return wrap(parts, j?.choices?.[0]?.finish_reason === "content_filter");
}

/* ---------- Anthropic ---------- */
export function toAnthropic(body, model, maxTokens) {
  const messages = [];
  const push = (role, blocks) => { if (!blocks.length) return; const last = messages[messages.length - 1]; if (last && last.role === role) last.content.push(...blocks); else messages.push({ role, content: blocks }); };
  for (const t of turns(body)) {
    if (t.role === "model") push("assistant", [...(t.text ? [{ type: "text", text: t.text }] : []), ...t.calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.args }))]);
    else push("user", [...t.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: JSON.stringify(r.response) })), ...(t.text ? [{ type: "text", text: t.text }] : [])]);
  }
  const tools = decls(body).map((d) => ({ name: d.name, description: d.description, input_schema: lower(d.parameters || { type: "object", properties: {} }) }));
  return { model, max_tokens: maxTokens, system: sysText(body) || undefined, messages, ...(tools.length ? { tools, tool_choice: { type: "auto" } } : {}), temperature: 0.4 };
}
export function fromAnthropic(j) {
  const parts = [];
  for (const b of j?.content || []) {
    if (b.type === "text" && b.text) parts.push({ text: b.text });
    else if (b.type === "tool_use") parts.push({ functionCall: { name: b.name, args: b.input || {} } });
  }
  return wrap(parts, j?.stop_reason === "refusal");
}

/** Gemini 3 rejects function calls in history that carry no thought signature (e.g. ones written by another provider). */
export function forGemini(contents) {
  return (contents || []).map((c) => c.role !== "model" ? c : { ...c, parts: (c.parts || []).map((p) => (p.functionCall && !p.thoughtSignature ? { ...p, thoughtSignature: "skip_thought_signature_validator" } : p)) });
}
