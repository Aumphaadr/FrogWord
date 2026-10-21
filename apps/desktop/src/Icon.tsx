// Значок интерфейса из набора Klaarheid Icons или фоновая лягушка. Рисуется цветом текста
// (currentColor); данные — в icons.ts, который собирает tools/build-icons.mjs (npm run icons).

import { ICONS, type IconName } from './icons.js';

export type { IconName };

export function Icon({
  name,
  size,
  className,
}: {
  name: IconName;
  /** Сторона в пикселях; без неё размер задаёт CSS. */
  size?: number;
  className?: string;
}) {
  const [viewBox, body] = ICONS[name];
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox={viewBox}
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
