import { HfInference } from '@huggingface/inference';

const hf = new HfInference(process.env.VITE_HF_ACCESS_TOKEN || '');

const SYSTEM_PROMPT = `You are an intent extraction engine for a cross-chain swap protocol. 
Your job is to parse the user's natural language request into a strict JSON array of objects representing their intents.
If the user specifies multiple intents (e.g. "swap X and then send Y"), return multiple objects in the array.
The JSON objects must perfectly match the following TypeScript interface:

type AmountKind = "token" | "usd";
type IntentAction = "swap" | "send";

interface RawIntent {
  action: IntentAction;
  amount: string | null;          // numeric string, no leading '$'. e.g. "100" (null if not stated)
  amountKind: AmountKind;         // "usd" if they mention dollars/bucks, "token" otherwise
  tokenIn: string | null;         // raw token symbol/alias as typed, e.g. "USDC"
  chainIn: string | null;         // raw chain alias as typed, e.g. "Base"
  tokenOut: string | null;        // target token (optional for send)
  chainOut: string | null;        // target chain (optional for send)
  recipient: string | null;       // null for 'swap', address/ens for 'send'
}

Return ONLY the JSON array, nothing else. If you absolutely cannot determine any intents, return {"error": "unrecognized"}. Do not make up information that is missing; use null.`;

async function main() {
  const norm = "swap 1 USDC on base sepolia for USDC on ethereum sepolia and then send 10 usdc on op sepolia to 0x632BF0D0d6468908378C3ccfAC4E788B115e0E55";
  
  const res = await hf.chatCompletion({
    model: "Qwen/Qwen2.5-Coder-32B-Instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: norm }
    ],
    max_tokens: 250,
    temperature: 0.1,
  });
  
  const content = res.choices[0]?.message?.content?.trim() || "";
  console.log("Raw Output:\n", content);
  
  let jsonStr = content;
  const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  } else {
    // In case it's just raw JSON without code blocks but might have prefix/suffix text
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      jsonStr = content.slice(firstBrace, lastBrace + 1);
    }
  }

  console.log("Extracted JSON:\n", jsonStr);
  const parsed = JSON.parse(jsonStr);
  console.log("Parsed:\n", parsed);
}

main().catch(console.error);
