import React from 'react';

interface FlutterIconProps {
  className?: string;
  size?: number;
}

/**
 * Official Flutter Logo SVG Icon
 */
export const FlutterIcon: React.FC<FlutterIconProps> = ({ className = 'w-4 h-4', size }) => {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Top Wing */}
      <path
        d="M14.314 0L2.3 12l3.7 3.7L21.686 0H14.314z"
        fill="#54C5F8"
      />
      {/* Middle Wing */}
      <path
        d="M14.314 11.314L8.3 17.329l3.7 3.7 9.686-9.715H14.314z"
        fill="#29B6F6"
      />
      {/* Bottom Fold */}
      <path
        d="M11.986 21.029L14.972 24H21.7l-6-6.014-3.714 3.043z"
        fill="#01579B"
      />
      {/* Bottom Diamond */}
      <path
        d="M8.3 17.329l3.686 3.7 3.714-3.7-3.714-3.714L8.3 17.329z"
        fill="#02569B"
      />
    </svg>
  );
};
