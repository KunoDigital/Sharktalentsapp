import { useFavorites } from '../hooks/useFavorites';

type FavType = 'job' | 'candidate' | 'draft' | 'client';

export function FavoriteButton({
  type,
  resourceId,
  label,
  size = 18,
}: {
  type: FavType;
  resourceId: string;
  label?: string;
  size?: number;
}) {
  const { toggle, isFavorite } = useFavorites();
  const isFav = isFavorite(type, resourceId);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggle(type, resourceId, label);
      }}
      title={isFav ? 'Quitar de favoritos' : 'Marcar como favorito'}
      style={{
        background: 'transparent',
        border: 0,
        cursor: 'pointer',
        padding: 4,
        color: isFav ? '#dc2626' : '#9ca3af',
        fontSize: size,
        lineHeight: 1,
      }}
      aria-label={isFav ? 'Quitar de favoritos' : 'Marcar como favorito'}
    >
      {isFav ? '★' : '☆'}
    </button>
  );
}
