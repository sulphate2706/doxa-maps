/**
 * loadPinnedUmd — load a PINNED, integrity-checked UMD library and capture it WITHOUT touching the host
 * page's global of the same name. One copy of what pplr-data-maps (60faff1a) and the Wall carried twice.
 *
 * WHY THE TRAP (measured on PPLR): a UMD build such as d3's writes its exports INTO an existing
 * global — `(t = globalThis).d3 = t.d3 || {}` — so a host that owns a d3 had ours written over it (577
 * added keys, version '7.9.0' on the host's object) even though we "put it back" afterwards. So while OUR
 * script executes (document.currentScript === the tag), `window[globalName]` reads and writes a private
 * slot; any other code, at every moment, reads and writes the host's own value. A non-configurable
 * `var` global cannot be trapped: it is emptied for the load and restored after.
 *
 * @param {{url: string, integrity: string}} pin  an entry of library/constants/cdn.js
 * @param {string} globalName  the name the UMD assigns (e.g. 'd3')
 * @returns {Promise<any>} the library, cached per url; rejects on network/integrity failure
 */
const cache = new Map()

export function loadPinnedUmd(pin, globalName) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.reject(new Error('no window'))
  if (cache.has(pin.url)) return cache.get(pin.url)
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = pin.url
    s.integrity = pin.integrity
    s.crossOrigin = 'anonymous'
    const own = Object.getOwnPropertyDescriptor(window, globalName)
    let hostValue = window[globalName]
    let ours
    let trapped = false
    if (!own || (own.configurable && 'value' in own)) {
      Object.defineProperty(window, globalName, {
        configurable: true, enumerable: own ? own.enumerable : true,
        get: () => (document.currentScript === s ? ours : hostValue),
        set: (v) => { if (document.currentScript === s) ours = v; else hostValue = v },
      })
      trapped = true
    } else if (own.writable) {
      window[globalName] = undefined
    }
    const restore = () => {
      if (trapped) {
        delete window[globalName]
        if (own || hostValue !== undefined) {
          Object.defineProperty(window, globalName, { value: hostValue, writable: own ? own.writable : true,
            configurable: true, enumerable: own ? own.enumerable : true })
        }
      } else if (own && own.writable) {
        window[globalName] = hostValue
      }
    }
    s.onload = () => {
      const got = trapped ? ours : window[globalName]
      restore()
      if (got) resolve(got)
      else { cache.delete(pin.url); reject(new Error(`${globalName} loaded but exported nothing (an AMD loader on the page?)`)) }
    }
    s.onerror = () => { restore(); cache.delete(pin.url); reject(new Error(`${globalName} failed to load (network or integrity)`)) }
    document.head.appendChild(s)
  })
  cache.set(pin.url, p)
  return p
}
