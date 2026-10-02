import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const source = fileURLToPath(new URL('../public/brand-symbol.svg', import.meta.url))
const output = (name) => fileURLToPath(new URL('../public/' + name, import.meta.url))
for (const [name, size] of [['icon-192.png',192], ['icon-512.png',512], ['icon-maskable-512.png',512], ['apple-touch-icon.png',180], ['favicon.png',48]]) {
  await sharp(source).resize(size, size).png().toFile(output(name))
}
console.log('Generated workspace CRM icons.')
