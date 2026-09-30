# Pure-Python Ed25519 (RFC 8032) — compact reference implementation.
# Used by the key manager to sign licenses without external deps.
import hashlib

p = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = -121665 * pow(121666, p-2, p) % p
I = pow(2, (p-1)//4, p)

def xrecover(y):
    xx = (y*y - 1) * pow(D*y*y + 1, p-2, p)
    x = pow(xx, (p+3)//8, p)
    if (x*x - xx) % p != 0:
        x = (x * I) % p
    if x % 2 != 0:
        x = p - x
    return x

By = 4 * pow(5, p-2, p) % p
Bx = xrecover(By)
B = (Bx % p, By % p, 1, (Bx*By) % p)
IDENT = (0, 1, 1, 0)

def edwards_add(P, Q):
    x1,y1,z1,t1 = P; x2,y2,z2,t2 = Q
    a = (y1-x1)*(y2-x2) % p
    b = (y1+x1)*(y2+x2) % p
    c = t1*2*D*t2 % p
    dd = z1*2*z2 % p
    e = b - a; f = dd - c; g = dd + c; h = b + a
    return (e*f % p, g*h % p, f*g % p, e*h % p)

def scalarmult(P, e):
    Q = (0, 1, 1, 0)
    while e > 0:
        if e & 1: Q = edwards_add(Q, P)
        P = edwards_add(P, P)
        e >>= 1
    return Q

def encodepoint(P):
    x,y,z,t = P
    zi = pow(z, p-2, p)
    x = x*zi % p; y = y*zi % p
    bits = [(y >> i) & 1 for i in range(255)] + [x & 1]
    return bytes(sum(bits[i*8+j] << j for j in range(8)) for i in range(32))

def Hint(m): return hashlib.sha512(m).digest()

def secret_expand(secret):
    if len(secret) != 32: raise Exception('bad seed')
    h = Hint(secret)
    a = int.from_bytes(h[:32], 'little')
    a &= (1 << 254) - 8
    a |= (1 << 254)
    return a, h[32:]

def publickey(secret):
    a, _ = secret_expand(secret)
    return encodepoint(scalarmult(B, a))

def signature(secret, msg):
    a, prefix = secret_expand(secret)
    A = encodepoint(scalarmult(B, a))
    r = int.from_bytes(Hint(prefix + msg), 'little') % L
    R = encodepoint(scalarmult(B, r))
    h = int.from_bytes(Hint(R + A + msg), 'little') % L
    s = (r + h * a) % L
    return R + s.to_bytes(32, 'little')

def verify(pub, msg, sig):
    if len(pub) != 32 or len(sig) != 64: return False
    A = decodepoint(pub)
    Rs = sig[:32]
    R = decodepoint(Rs)
    s = int.from_bytes(sig[32:], 'little')
    if s >= L: return False
    h = int.from_bytes(Hint(Rs + pub + msg), 'little') % L
    sB = scalarmult(B, s)
    hA = scalarmult(A, h)
    RhA = edwards_add(R, hA)
    return encodepoint(sB) == encodepoint(RhA)

def decodepoint(s):
    y = int.from_bytes(s, 'little') & ((1 << 255) - 1)
    x_sign = s[31] >> 7
    if y >= p: raise Exception('bad y')
    xx = (y*y - 1) * pow(D*y*y + 1, p-2, p)
    x = pow(xx, (p+3)//8, p)
    if (x*x - xx) % p != 0:
        x = (x * I) % p
    if (x*x - xx) % p != 0:
        raise Exception('point not on curve')
    if (x & 1) != x_sign:
        x = p - x
    return (x, y, 1, (x*y) % p)
