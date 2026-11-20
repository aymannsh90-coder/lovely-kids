/**
 * Reuse the uploaded gallery JPEG as a Story image without creating a second
 * media object. The server requires HTTPS/JPEG for both Facebook and Instagram.
 */
export function canUseGalleryImageForStory(imageUrl: string): boolean {
  try {
    const url = new URL(imageUrl.trim());
    return url.protocol === "https:" &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      /\.jpe?g$/i.test(url.pathname);
  } catch {
    return false;
  }
}

type GalleryImageState = {
  image: string;
  images: readonly string[];
};

export type AssignedStoryImageState = {
  image: string;
  images: string[];
  storyImage: string;
  /** False only if it is the last gallery image, which must remain for the shop. */
  movedFromGallery: boolean;
};

/**
 * Treat Story selection as a move of the existing URL, never as a new upload.
 * A product always needs at least one gallery/main image: its sole photo is
 * safely shared by reference rather than removed. Color variant images are
 * managed separately and intentionally remain untouched.
 */
export function assignGalleryImageToStory(
  current: GalleryImageState,
  selectedUrl: string,
): AssignedStoryImageState | null {
  if (!current.images.includes(selectedUrl) ||
      !canUseGalleryImageForStory(selectedUrl)) return null;

  const remaining = current.images.filter((url) => url !== selectedUrl);

  if (remaining.length === 0) {
    // Never leave a product without an image. Sharing the URL costs no storage.
    return {
      image: selectedUrl,
      images: [selectedUrl],
      storyImage: selectedUrl,
      movedFromGallery: false,
    };
  }

  return {
    image: remaining.includes(current.image) ? current.image : remaining[0],
    images: remaining,
    storyImage: selectedUrl,
    movedFromGallery: true,
  };
}
