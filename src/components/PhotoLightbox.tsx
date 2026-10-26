import React, { useEffect } from 'react';
import { TravelPhoto } from '../types';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface PhotoLightboxProps {
  photos: TravelPhoto[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export const PhotoLightbox: React.FC<PhotoLightboxProps> = ({
  photos,
  currentIndex,
  isOpen,
  onClose,
  onNavigate,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && currentIndex < photos.length - 1) onNavigate(currentIndex + 1);
      if (e.key === 'ArrowLeft' && currentIndex > 0) onNavigate(currentIndex - 1);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, photos.length, onClose, onNavigate]);

  if (!isOpen || photos.length === 0) return null;

  const currentPhoto = photos[currentIndex] || photos[0];

  return (
    <div className="fixed inset-0 z-60 bg-black/95 flex flex-col items-center justify-center p-4">
      {/* Top Header */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between text-white z-10">
        <div className="text-sm font-medium text-stone-300">
          {currentIndex + 1} / {photos.length}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Main Image View */}
      <div className="relative max-w-5xl max-h-[80vh] w-full flex items-center justify-center">
        <img
          src={currentPhoto.url}
          alt={currentPhoto.caption || 'Travel photo'}
          className="max-h-[80vh] max-w-full object-contain rounded-lg shadow-2xl"
        />

        {/* Prev / Next controls */}
        {photos.length > 1 && (
          <>
            <button
              type="button"
              disabled={currentIndex === 0}
              onClick={() => onNavigate(currentIndex - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-stone-900/60 hover:bg-stone-900 text-white disabled:opacity-30 disabled:pointer-events-none transition"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              type="button"
              disabled={currentIndex === photos.length - 1}
              onClick={() => onNavigate(currentIndex + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-stone-900/60 hover:bg-stone-900 text-white disabled:opacity-30 disabled:pointer-events-none transition"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}
      </div>

      {/* Caption Overlay */}
      {currentPhoto.caption && (
        <div className="mt-4 px-6 py-2 rounded-full bg-stone-900/80 text-stone-200 text-sm max-w-xl text-center backdrop-blur border border-stone-800">
          {currentPhoto.caption}
        </div>
      )}
    </div>
  );
};
