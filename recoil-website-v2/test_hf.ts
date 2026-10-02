t import { HfInference } from '@huggingface/inference';
const hf = new HfInference(process.env.VITE_HF_ACCESS_TOKEN || '');
async function test() {
  try {
    const res = await hf.chatCompletion({
      model: "Qwen/Qwen2.5-Coder-32B-Instruct",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 10,
    });
    console.log(res);
  } catch (error: any) {
    console.error("error:", JSON.stringify(error, null, 2));
  }
}
test();
