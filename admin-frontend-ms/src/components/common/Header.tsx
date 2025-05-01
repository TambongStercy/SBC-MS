import React from "react";

interface HeaderProps {
  title: string;
  avatar?: string;
  name?: string;
}

const Header: React.FC<HeaderProps> = ({ title, avatar, name }) => {
  return (
    <header className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg border-b border-gray-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center py-4">
        {avatar && (
          <img
            src={avatar}
            alt={name || "User avatar"}
            className="rounded-full w-12 h-12 object-cover mr-4"
          />
        )}
        <div>
          <h1 className="text-2xl font-semibold text-gray-100">{title}</h1>
          {name && <p className="text-gray-400">{name}</p>}
        </div>
      </div>
    </header>
  );
};

export default Header;
