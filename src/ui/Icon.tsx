// An icon of the approved designs (Lucide, src/styles/icons.css): <Icon name="utensils" size={18} />
type Size = 14 | 16 | 18 | 20 | 22 | 24 | 28 | 32;

export function Icon({ name, size = 20, label }: { name: string; size?: Size; label?: string }) {
  const cls = 'i i-' + name + (size === 20 ? '' : ' s' + size);
  return label ? <i className={cls} role="img" aria-label={label} /> : <i className={cls} aria-hidden="true" />;
}
