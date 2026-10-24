import type {Session} from './types';
export function sameSession(a: Session, b: Session) {
  return a.user.id === b.user.id && a.user.role === b.user.role && a.company?.id === b.company?.id;
}
