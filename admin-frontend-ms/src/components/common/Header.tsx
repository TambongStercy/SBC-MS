import React from "react";

interface HeaderProps {
  title: string;
  avatar?: string;
  name?: string;
}

/** Page title (same look as the kit's PageHeader): no bar, no shadow; `name` is shown as the description line. */
const Header: React.FC<HeaderProps> = ({ title, avatar, name }) => {
  return (
    <header className="mb-6 flex items-center gap-4">
      {avatar && (
        <img
          src={avatar}
          alt={name || "Avatar"}
          className="h-12 w-12 shrink-0 rounded-full object-cover"
        />
      )}
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {name && <p className="mt-1 text-sm text-fg-muted">{name}</p>}
      </div>
    </header>
  );
};

export default Header;
