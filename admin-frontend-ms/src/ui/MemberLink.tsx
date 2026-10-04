import { Link } from 'react-router-dom';
import { Avatar } from './Avatar';
import { formatPhone } from '../lib/format';

export const memberPath = (id: string) => `/membres/${id}`;

/** A member as admins recognise them: photo, name, phone — never a raw id. */
export function MemberLink({ id, name, phone, avatar, sub, link = true }: {
    id?: string | null; name?: string | null; phone?: string | number | null; avatar?: string | null; sub?: React.ReactNode; link?: boolean;
}) {
    const body = (
        <span className="flex items-center gap-2.5 min-w-0">
            <Avatar name={name} src={avatar} size={36} />
            <span className="min-w-0">
                <span className="block font-semibold text-ink truncate">{name || 'Membre sans nom'}</span>
                <span className="block text-xs text-ink-2 truncate">{sub ?? (phone ? formatPhone(phone) : null)}</span>
            </span>
        </span>
    );
    return link && id ? (
        <Link to={memberPath(id)} onClick={e => e.stopPropagation()} className="block min-w-0 hover:opacity-80">{body}</Link>
    ) : body;
}
