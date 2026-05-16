import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const RAW_JWT_SECRET = process.env.JWT_SECRET;
const JWT_SECRET = new TextEncoder().encode(
  RAW_JWT_SECRET || 'sky-chat-secret-key-change-in-production'
);

async function verifyTokenFromRequest(request: NextRequest) {
  // In production, JWT_SECRET must be explicitly set, or all requests are denied
  if (!RAW_JWT_SECRET && process.env.NODE_ENV === 'production') {
    console.error('JWT_SECRET is not configured in production environment');
    return null;
  }

  const token = request.cookies.get('sky-chat-token')?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const user = await verifyTokenFromRequest(request);

  if (pathname.startsWith('/chat')) {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  if (pathname.startsWith('/admin')) {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    if (user.role !== 'admin') {
      return NextResponse.redirect(new URL('/chat', request.url));
    }
  }

  if (pathname === '/login' || pathname === '/register') {
    if (user) {
      return NextResponse.redirect(new URL('/chat', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/chat/:path*', '/admin/:path*', '/login', '/register'],
};
