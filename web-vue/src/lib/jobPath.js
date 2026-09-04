function rotateLeft(value, bits) {
  return (value << bits) | (value >>> (32 - bits))
}

// Small browser-safe SHA-1 implementation. The static-page generator uses the
// same SHA-1 suffix, so SPA links resolve to the already-generated job pages.
function sha1(value) {
  const bytes = new TextEncoder().encode(String(value || ''))
  const words = []
  for (let index = 0; index < bytes.length; index += 1) {
    words[index >> 2] = (words[index >> 2] || 0) | (bytes[index] << (24 - (index % 4) * 8))
  }
  words[bytes.length >> 2] = (words[bytes.length >> 2] || 0) | (0x80 << (24 - (bytes.length % 4) * 8))
  words[(((bytes.length + 8) >> 6) + 1) * 16 - 1] = bytes.length * 8

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const schedule = new Array(80)

  for (let offset = 0; offset < words.length; offset += 16) {
    for (let index = 0; index < 80; index += 1) {
      schedule[index] = index < 16
        ? (words[offset + index] || 0)
        : rotateLeft(schedule[index - 3] ^ schedule[index - 8] ^ schedule[index - 14] ^ schedule[index - 16], 1)
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let index = 0; index < 80; index += 1) {
      let f
      let k
      if (index < 20) { f = (b & c) | ((~b) & d); k = 0x5a827999 }
      else if (index < 40) { f = b ^ c ^ d; k = 0x6ed9eba1 }
      else if (index < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc }
      else { f = b ^ c ^ d; k = 0xca62c1d6 }
      const temp = (rotateLeft(a, 5) + f + e + k + schedule[index]) | 0
      e = d
      d = c
      c = rotateLeft(b, 30)
      b = a
      a = temp
    }
    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
  }
  return [h0, h1, h2, h3, h4].map((part) => (part >>> 0).toString(16).padStart(8, '0')).join('')
}

function kebab(value, max) {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return max ? slug.slice(0, max).replace(/-+$/g, '') : slug
}

export function jobDetailPath(job = {}) {
  const key = String(job.canonicalJobId || job.url || `${job.title}|${job.college}`)
  const parts = [kebab(job.title, 60), kebab(job.college, 40), sha1(key).slice(0, 6)].filter(Boolean)
  return `/jobs/${parts.join('-')}/`
}
