export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function cloudinaryImageUrl(source: string | undefined, width: number) {
  if (!source || !source.includes('res.cloudinary.com/') || !source.includes('/image/upload/')) return source;
  return source.replace('/image/upload/', `/image/upload/f_auto,q_auto,w_${width}/`);
}
