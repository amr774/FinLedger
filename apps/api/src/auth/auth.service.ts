import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';
import * as argon2 from 'argon2';
import { Database } from '../infrastructure/database';
import { LoginDto, RegisterDto } from './auth.dto';
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
@Injectable()
export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly jwt: JwtService,
  ) {}
  async register(dto: RegisterDto) {
    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });
    try {
      return await this.db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: dto.email, name: dto.name, passwordHash },
        });
        return this.createSession(user.id, tx);
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException('Registration unavailable for this email');
      throw e;
    }
  }
  async login(dto: LoginDto) {
    const user = await this.db.user.findUnique({ where: { email: dto.email } });
    // A real Argon2 hash is computed for unknown users to avoid a fast lookup oracle.
    const valid = user
      ? await argon2.verify(user.passwordHash, dto.password)
      : (await argon2.hash(dto.password), false);
    if (!user || !valid) throw new UnauthorizedException('Invalid credentials');
    return this.createSession(user.id);
  }
  private async createSession(
    userId: string,
    db: Prisma.TransactionClient = this.db,
  ) {
    const refreshToken = randomBytes(48).toString('base64url');
    const session = await db.session.create({
      data: {
        userId,
        expiresAt: new Date(Date.now() + 7 * 86400000),
        tokens: { create: { hash: hash(refreshToken) } },
      },
    });
    return {
      accessToken: await this.jwt.signAsync({ sub: userId, sid: session.id }),
      refreshToken,
    };
  }
  async refresh(token?: string) {
    if (!token) throw new UnauthorizedException('Missing refresh token');
    const result = await this.db.$transaction(async (tx) => {
      const known = await tx.refreshToken.findUnique({
        where: { hash: hash(token) },
      });
      if (!known) return null;
      await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${known.sessionId}::uuid FOR UPDATE`;
      const current = await tx.refreshToken.findUniqueOrThrow({
        where: { id: known.id },
        include: { session: true },
      });
      if (current.usedAt) {
        await tx.session.update({
          where: { id: current.sessionId },
          data: { revokedAt: new Date() },
        });
        return null;
      }
      if (current.session.revokedAt || current.session.expiresAt < new Date())
        return null;
      const next = randomBytes(48).toString('base64url');
      await tx.refreshToken.update({
        where: { id: current.id },
        data: { usedAt: new Date() },
      });
      await tx.refreshToken.create({
        data: { hash: hash(next), sessionId: current.sessionId },
      });
      return {
        refreshToken: next,
        userId: current.session.userId,
        sid: current.sessionId,
      };
    });
    if (!result)
      throw new UnauthorizedException(
        'Session expired or refresh token reused',
      );
    return {
      refreshToken: result.refreshToken,
      accessToken: await this.jwt.signAsync({
        sub: result.userId,
        sid: result.sid,
      }),
    };
  }
  async logout(token?: string) {
    if (token) {
      const row = await this.db.refreshToken.findUnique({
        where: { hash: hash(token) },
      });
      if (row)
        await this.db.session.update({
          where: { id: row.sessionId },
          data: { revokedAt: new Date() },
        });
    }
    return { ok: true };
  }
}
