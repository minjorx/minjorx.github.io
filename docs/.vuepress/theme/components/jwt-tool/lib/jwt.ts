/**
 * JWT 解析 / 验证 / 过期检查
 *
 * - parse: 解析 Header + Payload，不验证签名
 * - verify: 用 secret 验证 HS256 / HS384 / HS512 签名
 * - checkExpiry: 检查 exp / nbf / iat 是否过期
 */

export interface JwtHeader {
  alg: string
  typ?: string
  [k: string]: unknown
}

export interface JwtPayload {
  exp?: number
  nbf?: number
  iat?: number
  iss?: string
  sub?: string
  aud?: string | string[]
  jti?: string
  [k: string]: unknown
}

export type ExpiryStatus = 'valid' | 'expired' | 'not-yet-valid' | 'no-exp' | 'invalid-exp'

export interface ParsedJwt {
  valid: boolean
  header?: JwtHeader
  payload?: JwtPayload
  signature?: string
  error?: string
  raw: { header: string; payload: string; signature: string }
}

export interface VerifyResult {
  valid: boolean
  error?: string
}

export interface ExpiryInfo {
  status: ExpiryStatus
  message: string
  expiresAt?: Date
  notBefore?: Date
  issuedAt?: Date
}

// base64url 解码（兼容标准 base64 和带空格的格式）
function base64UrlDecode(s: string): Uint8Array {
  let str = s.replace(/[\r\n\s]/g, '')
  // 补全 padding
  const pad = str.length % 4
  if (pad === 2) str += '=='
  else if (pad === 3) str += '='
  else if (pad === 1) str += 'A=='
  // 替换字符
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * 解析 JWT 字符串
 * 不验证签名，只解码 Header / Payload / Signature
 */
export function parseJwt(token: string): ParsedJwt {
  const empty: ParsedJwt = { valid: false, error: '', raw: { header: '', payload: '', signature: '' } }
  if (!token || !token.trim()) {
    return { ...empty, error: '请输入 JWT 字符串' }
  }
  const parts = token.trim().split('.')
  if (parts.length !== 3) {
    return { ...empty, error: `JWT 应有 3 段（header.payload.signature），当前 ${parts.length} 段` }
  }
  const [h, p, s] = parts
  try {
    const headerBytes = base64UrlDecode(h)
    const payloadBytes = base64UrlDecode(p)
    const header = JSON.parse(utf8Decode(headerBytes)) as JwtHeader
    const payload = JSON.parse(utf8Decode(payloadBytes)) as JwtPayload
    if (!header.alg) {
      return {
        ...empty,
        valid: false,
        error: 'Header 缺少 alg 字段',
        raw: { header: h, payload: p, signature: s },
      }
    }
    return {
      valid: true,
      header,
      payload,
      signature: s,
      raw: { header: h, payload: p, signature: s },
    }
  } catch (e: any) {
    return {
      ...empty,
      valid: false,
      error: '解析失败：' + (e?.message || String(e)),
      raw: { header: h, payload: p, signature: s },
    }
  }
}

/**
 * 用 secret 验证 HS256 / HS384 / HS512 签名
 */
export async function verifyHsSignature(
  token: string,
  secret: string,
): Promise<VerifyResult> {
  try {
    const parsed = parseJwt(token)
    if (!parsed.valid || !parsed.header || !parsed.signature) {
      return { valid: false, error: 'JWT 解析失败，无法验证' }
    }
    const alg = parsed.header.alg
    if (!alg.startsWith('HS')) {
      return { valid: false, error: `当前仅支持 HS* 算法（实际是 ${alg}）` }
    }
    const hashName = alg  // 'HS256' / 'HS384' / 'HS512'
    // 重新组装 signing input（header.payload）
    const signingInput = `${parsed.raw.header}.${parsed.raw.payload}`
    const keyData = new TextEncoder().encode(secret)
    const data = new TextEncoder().encode(signingInput)
    // 验签
    const expectedBytes = base64UrlDecode(parsed.signature)
    // Web Crypto 算法名：HMAC + 去掉 HS 前缀
    // e.g. HS256 → HMAC with SHA-256
    const subtleAlg = `HS-${alg.slice(2)}`  // 'HS-256' / 'HS-384' / 'HS-512'
    let cryptoAlgName: AlgorithmIdentifier
    switch (subtleAlg) {
      case 'HS-256': cryptoAlgName = { name: 'HMAC', hash: 'SHA-256' } as any; break
      case 'HS-384': cryptoAlgName = { name: 'HMAC', hash: 'SHA-384' } as any; break
      case 'HS-512': cryptoAlgName = { name: 'HMAC', hash: 'SHA-512' } as any; break
      default: return { valid: false, error: `不支持的算法：${alg}` }
    }
    const isValid = await crypto.subtle.verify('HMAC' as any, cryptoAlgName as any, expectedBytes as BufferSource, keyData, data)
    return isValid
      ? { valid: true }
      : { valid: false, error: '签名不匹配' }
  } catch (e: any) {
    return { valid: false, error: '验证异常：' + (e?.message || String(e)) }
  }
}

/**
 * 检查 JWT 过期状态（基于 exp / nbf / iat）
 */
export function checkExpiry(payload: JwtPayload | undefined): ExpiryInfo {
  if (!payload) {
    return { status: 'invalid-exp', message: 'payload 缺失' }
  }
  const now = Math.floor(Date.now() / 1000)
  const exp = typeof payload.exp === 'number' ? payload.exp : undefined
  const nbf = typeof payload.nbf === 'number' ? payload.nbf : undefined
  const iat = typeof payload.iat === 'number' ? payload.iat : undefined

  if (exp === undefined && nbf === undefined) {
    return { status: 'no-exp', message: '没有 exp / nbf 字段' }
  }

  // nbf（not before）检查
  if (nbf !== undefined && now < nbf) {
    return {
      status: 'not-yet-valid',
      message: `尚未生效：${new Date(nbf * 1000).toLocaleString()} 之后可用`,
      notBefore: new Date(nbf * 1000),
    }
  }

  // exp 检查
  if (exp !== undefined) {
    if (now >= exp) {
      return {
        status: 'expired',
        message: `已过期：${new Date(exp * 1000).toLocaleString()} 已过`,
        expiresAt: new Date(exp * 1000),
      }
    }
    return {
      status: 'valid',
      message: `有效：${new Date(exp * 1000).toLocaleString()} 之前有效`,
      expiresAt: new Date(exp * 1000),
    }
  }

  // 只有 nbf 没 exp，且当前 >= nbf
  return {
    status: 'valid',
    message: '有效（仅有 nbf 检查）',
    notBefore: nbf !== undefined ? new Date(nbf * 1000) : undefined,
  }
}

/** 格式化时间戳为本地字符串 */
export function formatTimestamp(ts: number | undefined): string {
  if (ts === undefined) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false })
}

/** 计算相对时间（距离现在多久） */
export function timeAgo(ts: number | undefined): string {
  if (ts === undefined) return '-'
  const now = Date.now() / 1000
  const diff = now - ts
  const abs = Math.abs(diff)
  const sign = diff >= 0 ? '前' : '后'
  const days = Math.floor(abs / 86400)
  const hours = Math.floor((abs % 86400) / 3600)
  const mins = Math.floor((abs % 3600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时 ${sign}`
  if (hours > 0) return `${hours} 小时 ${mins} 分钟 ${sign}`
  return `${mins} 分钟 ${sign}`
}
