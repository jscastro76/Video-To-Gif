import { pipeline, env } from '@huggingface/transformers';
env.allowLocalModels = false;
async function test() {
  const segmenter = await pipeline('background-removal', 'Xenova/modnet');
  const output = await segmenter('https://picsum.photos/200/300');
  console.log(typeof output.toBlob);
}
test();
