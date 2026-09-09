/** Deterministically resize/pad the approved logo; no artwork retouching.
 * Usage: node scripts/package-brand.mjs (sharp or SHARP_MODULE required).
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let sharp
try {
  sharp = require(process.env.SHARP_MODULE || 'sharp')
} catch (error) {
  if (process.env.SHARP_MODULE) throw error
  sharp = require(path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'))
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const brandDirectory = 'design/v1.6.0'
const sourcePath = `${brandDirectory}/brand-symbol.png`
const source = await readFile(path.join(root, sourcePath))
const background = '#F7F8FC'
const outputs = []
const densityScales = { ldpi: 0.75, mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
const adaptiveScale = 0.8

async function save(relativePath, pipeline, expectedWidth, expectedHeight) {
  const fullPath = path.join(root, relativePath)
  await mkdir(path.dirname(fullPath), { recursive: true })
  const buffer = await pipeline.png({ compressionLevel: 9 }).toBuffer()
  const metadata = await sharp(buffer).metadata()
  if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) throw new Error(`Unexpected dimensions for ${relativePath}`)
  await writeFile(fullPath, buffer)
  outputs.push({ path: relativePath.replaceAll('\\', '/'), width: metadata.width, height: metadata.height, alpha: metadata.hasAlpha, bytes: buffer.length })
  return buffer
}
function canvas(width, height) {
  return sharp({ create: { width, height, channels: 3, background } })
}
async function padded(width, height, artworkSide) {
  const symbol = await sharp(source).resize(artworkSide, artworkSide, { fit: 'contain', background }).removeAlpha().png().toBuffer()
  return canvas(width, height).composite([{ input: symbol, left: Math.floor((width - artworkSide) / 2), top: Math.floor((height - artworkSide) / 2) }])
}
function roundMask(size) {
  return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`)
}

// Store icons deliberately have no pre-rounded corners or alpha channel.
await save('resources/icon.png', sharp(source).resize(1024, 1024).removeAlpha(), 1024, 1024)
await save(`${brandDirectory}/store-icon-512.png`, sharp(source).resize(512, 512).removeAlpha(), 512, 512)
await save('public/brand/wallet-diary-mark.png', sharp(source).resize(256, 256).removeAlpha(), 256, 256)
await save('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', sharp(source).resize(1024, 1024).removeAlpha(), 1024, 1024)
for (const [density, scale] of Object.entries(densityScales)) {
  const directory = `android/app/src/main/res/mipmap-${density}`
  const legacySize = Math.round(48 * scale)
  const adaptiveSize = Math.round(108 * scale)
  const legacy = await sharp(source).resize(legacySize, legacySize).removeAlpha().png().toBuffer()
  await save(`${directory}/ic_launcher.png`, sharp(legacy), legacySize, legacySize)
  await save(`${directory}/ic_launcher_round.png`, sharp(legacy).ensureAlpha().composite([{ input: roundMask(legacySize), blend: 'dest-in' }]), legacySize, legacySize)
  await save(`${directory}/ic_launcher_background.png`, canvas(adaptiveSize, adaptiveSize), adaptiveSize, adaptiveSize)
  // The original symbol already has whitespace. One extra 80% scale puts its
  // silhouette inside the 66dp safe circle. The XML must not add another inset.
  await save(`${directory}/ic_launcher_foreground.png`, await padded(adaptiveSize, adaptiveSize, Math.round(adaptiveSize * adaptiveScale)), adaptiveSize, adaptiveSize)
}

// Retain the existing platform splash dimensions. Night matches the light UI.
await save('resources/splash.png', await padded(2732, 2732, 1000), 2732, 2732)
for (const relativeRoot of ['android/app/src/main/res', 'ios/App/App/Assets.xcassets/Splash.imageset']) {
  async function walk(relativeDirectory) {
    const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true })
    for (const entry of entries) {
      const relativeFile = `${relativeDirectory}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(relativeFile)
      } else if (entry.name.endsWith('.png') && (entry.name === 'splash.png' || relativeRoot.includes('Splash.imageset'))) {
        const { width, height } = await sharp(path.join(root, relativeFile)).metadata()
        const artworkSide = relativeRoot.includes('ios/') ? 1000 : Math.round(Math.min(width, height) * 0.6)
        await save(relativeFile, await padded(width, height, artworkSide), width, height)
      }
    }
  }
  await walk(relativeRoot)
}

// Small-size deliverables and actual 72/108 launcher viewport masks.
for (const size of [48, 96]) {
  await save(`${brandDirectory}/icon-${size}.png`, sharp(source).resize(size, size).removeAlpha(), size, size)
  const adaptiveCanvas = await (await padded(432, 432, Math.round(432 * adaptiveScale))).png().toBuffer()
  const visible = await sharp(adaptiveCanvas).extract({ left: 72, top: 72, width: 288, height: 288 }).resize(size, size).png().toBuffer()
  await save(`${brandDirectory}/icon-adaptive-round-${size}.png`, sharp(visible).ensureAlpha().composite([{ input: roundMask(size), blend: 'dest-in' }]), size, size)
}

// Saturated silhouette pixels (not pale paper) must fit radius 33dp on 108dp.
const { data, info } = await sharp(path.join(root, 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true })
let maxRadiusPx = 0
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const offset = (y * info.width + x) * info.channels
    const channels = [data[offset], data[offset + 1], data[offset + 2]]
    if (Math.max(...channels) - Math.min(...channels) > 50 && Math.min(...channels) < 180) {
      maxRadiusPx = Math.max(maxRadiusPx, Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2))
    }
  }
}
const maxRadiusDp = maxRadiusPx / 4
if (maxRadiusDp > 33) throw new Error(`Adaptive symbol exceeds safe circle: ${maxRadiusDp.toFixed(2)}dp`)
const report = {
  source: sourcePath,
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  background,
  operation: 'Proportional resizing, centered padding, and platform circle masks only; original artwork is unchanged.',
  adaptive: { canvasDp: 108, safeRadiusDp: 33, measuredSilhouetteRadiusDp: Number(maxRadiusDp.toFixed(3)), xmlExtraInset: false },
  outputs,
}
await writeFile(path.join(root, brandDirectory, 'brand-packaging.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`Packaged ${outputs.length} assets. Adaptive silhouette radius ${maxRadiusDp.toFixed(2)}dp / 33dp. iOS/store icons are opaque.`)
