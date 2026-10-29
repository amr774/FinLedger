import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Database } from '../infrastructure/database';
import { isUUID } from 'class-validator';
export type Principal = {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  sid: string;
};
export const Public = () => SetMetadata('public', true);
export const Admin = () => SetMetadata('admin', true);
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly db: Database) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET!,
      algorithms: ['HS256'],
      issuer: 'finledger',
      audience: 'finledger-web',
    });
  }
  async validate(payload: { sub: string; sid: string }): Promise<Principal> {
    if (!payload || !isUUID(payload.sub) || !isUUID(payload.sid))
      throw new UnauthorizedException();
    const session = await this.db.session.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt < new Date()
    )
      throw new UnauthorizedException();
    const { id, email, name, role } = session.user;
    return { id, email, name, role, sid: session.id };
  }
}
@Injectable()
export class JwtGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }
  canActivate(ctx: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride('public', [
        ctx.getHandler(),
        ctx.getClass(),
      ])
    )
      return true;
    return super.canActivate(ctx);
  }
}
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride('admin', [
        ctx.getHandler(),
        ctx.getClass(),
      ]) &&
      ctx.switchToHttp().getRequest<{ user?: Principal }>().user?.role !==
        'ADMIN'
    )
      throw new ForbiddenException();
    return true;
  }
}
