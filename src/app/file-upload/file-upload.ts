import { Component, NgZone, OnDestroy, ElementRef, ViewChild, ChangeDetectorRef  } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

// Metadata for preview
interface PreviewFile {
  id: number;
  fileName: string;
  size: number;
  url: string | null;
  objectUrl?: string;
  loading: boolean;
  progress: number;
  totalChunks?: number;
}

// IndexedDB chunk record
interface FileChunk {
  fileId: number;
  chunkIndex: number;
  totalChunks: number;
  data: ArrayBuffer;
}

@Component({
  selector: 'app-file-upload',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './file-upload.html',
  styleUrls: ['./file-upload.scss']
})
export class FileUpload implements OnDestroy {
  images: PreviewFile[] = [];
  videos: PreviewFile[] = [];

  @ViewChild('fileInputImage') fileInputImage!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInputVideo') fileInputVideo!: ElementRef<HTMLInputElement>;

  isDragOver = { image: false, video: false };

  private idCounter = 0;
  private rafHandles = new Map<number, number>();

  private dbPromise: Promise<IDBDatabase>;

  private findById(id: number) {
    return this.images.find(i => i.id === id) || this.videos.find(v => v.id === id) || null;
  }

  constructor(private zone: NgZone, private cdr: ChangeDetectorRef) {
    this.dbPromise = this.openDB();
  }

  // --- IndexedDB setup ---
  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof window === "undefined" || !window.indexedDB) {
        reject(new Error("indexedDB is not supported in this environment"));
        return;
      }

      const request = window.indexedDB.open("FileUploadDB", 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("chunks")) {
          db.createObjectStore("chunks", { keyPath: ["fileId", "chunkIndex"] });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }


  private async saveChunk(chunk: FileChunk) {
    const db = await this.dbPromise;
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('chunks', 'readwrite');
      tx.objectStore('chunks').put(chunk);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async clearChunksByFileId(fileId: number) {
    const db = await this.dbPromise;
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('chunks', 'readwrite');
      const store = tx.objectStore('chunks');
      const index = store.index('fileId');
      const range = IDBKeyRange.only(fileId);
      const request = index.openCursor(range);

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private storageKey(type: 'image' | 'video') {
    return type === 'image' ? 'uploaded_images' : 'uploaded_videos';
  }

  // --- Drag/drop handlers ---
  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  onDragLeave(event: DragEvent, type: 'image' | 'video') {
    this.isDragOver[type] = false;
  }

  onFileDropped(event: DragEvent, type: 'image' | 'video') {
    event.preventDefault();
    this.isDragOver[type] = false;
    if (event.dataTransfer?.files) this.handleFiles(event.dataTransfer.files, type);
  }

  onFileSelected(event: Event, type: 'image' | 'video') {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    this.handleFiles(input.files, type);
    input.value = '';
  }

  // --- Core: split file into chunks and save to IndexedDB ---
  handleFiles(files: FileList, type: 'image' | 'video') {
    Array.from(files).forEach(file => {
      const id = ++this.idCounter;
      const objectUrl = URL.createObjectURL(file);
      const chunkSize = 1024 * 256; // 256 KB
      const totalChunks = Math.ceil(file.size / chunkSize);

      // Preview metadata
      const placeholder: PreviewFile = {
        id,
        fileName: file.name,
        size: file.size,
        url: objectUrl,
        objectUrl,
        loading: true,
        progress: 0,
        totalChunks
      };

      // Add to proper list
      if (type === 'image') this.images.push(placeholder);
      else this.videos.push(placeholder);

      let currentChunk = 0;

      // Recursive chunk processor
      const processNextChunk = async () => {
        if (currentChunk >= totalChunks) {
          // Mark file as fully loaded
          this.zone.run(() => {
            placeholder.loading = false;
            placeholder.progress = 100;
            this.cdr.markForCheck();
          });
          return;
        }

        const start = currentChunk * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const blob = file.slice(start, end);

        try {
          const arrayBuffer = await blob.arrayBuffer();

          // Save chunk to IndexedDB
          await this.saveChunk({
            fileId: id,
            chunkIndex: currentChunk,
            totalChunks,
            data: arrayBuffer
          });

          currentChunk++;

          // Update progress inside NgZone
          this.zone.run(() => {
            const percent = Math.round((currentChunk / totalChunks) * 100);
            console.log("progress", percent)
            placeholder.progress = percent;

            this.cdr.markForCheck();
          });

          // Process next chunk with a small delay to allow UI updates
          setTimeout(processNextChunk, 0);

        } catch (error) {
          console.error('Error processing chunk:', error);
          this.zone.run(() => {
            placeholder.loading = false;
            this.cdr.markForCheck();
          });
        }
      };

      // Start processing
      processNextChunk();
    });
  }

  // Remove single preview
  async removePreview(id: number, event: Event) {
    event.stopPropagation();
    console.log('removePreview called for id:', id);
    
    await this.clearChunksByFileId(id);

    // Check if it's an image
    const imgIndex = this.images.findIndex(i => i.id === id);
    if (imgIndex > -1) {
      const it = this.images[imgIndex];
      if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
      
      // Create a new array without the item (immutable update)
      this.images = this.images.filter(item => item.id !== id);
      this.cdr.markForCheck(); // Force change detection
      console.log('Image removed successfully. New images array:', this.images);
      return;
    }

    // Check if it's a video
    const vidIndex = this.videos.findIndex(v => v.id === id);
    if (vidIndex > -1) {
      const it = this.videos[vidIndex];
      if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
      
      // Create a new array without the item (immutable update)
      this.videos = this.videos.filter(item => item.id !== id);
      this.cdr.markForCheck(); // Force change detection
      console.log('Video removed successfully. New videos array:', this.videos);
    }
  }

  // Remove all previews
  removeAll(type: 'image' | 'video') {
    const items = type === 'image' ? this.images : this.videos;
    items.forEach(async it => {
      await this.clearChunksByFileId(it.id);
      if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
    });

    // Use immutable updates
    if (type === 'image') {
      this.images = [];
      this.clearFileInput('image');
    } else {
      this.videos = [];
      this.clearFileInput('video');
    }
    
    this.cdr.markForCheck(); // Force change detection
  }

  // Upload all (just marking as saved in localStorage for now)
  // --- Upload all (metadata in localStorage, chunks in IndexedDB only) ---
  async uploadAll(type: 'image' | 'video') {
    const items = type === 'image' ? this.images : this.videos;
    if (items.length === 0) return;

    // Prepare metadata array for localStorage
    const metadata = items.map(f => ({
      id: f.id,
      name: f.fileName,
      size: f.size,
      totalChunks: f.totalChunks,
      uploadedAt: Date.now()
    }));

    // Save metadata only to localStorage
    localStorage.setItem(this.storageKey(type), JSON.stringify(metadata));

    // Ensure all chunks are already in IndexedDB
    const db = await this.dbPromise;
    for (const f of items) {
      const store = db.transaction('chunks', 'readonly').objectStore('chunks');
      const allChunks: FileChunk[] = await new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
          const fileChunks = request.result.filter(c => c.fileId === f.id);
          resolve(fileChunks);
        };
        request.onerror = () => reject(request.error);
      });

      // verify all chunks are present
      if (allChunks.length !== (f.totalChunks || 0)) {
        console.warn(`File ${f.fileName} is missing some chunks in IndexedDB!`);
      }
    }

    alert(`${type === 'image' ? 'Images' : 'Videos'} metadata saved to localStorage and chunks remain in IndexedDB!`);
  }

  // Reset <input type="file">
  clearFileInput(type: 'image' | 'video') {
    if (type === 'image' && this.fileInputImage) {
      this.fileInputImage.nativeElement.value = '';
    }
    if (type === 'video' && this.fileInputVideo) {
      this.fileInputVideo.nativeElement.value = '';
    }
  }

  trackById(_i: number, item: PreviewFile) {
    return item.id;
  }

  ngOnDestroy(): void {
    this.images.concat(this.videos).forEach(it => {
      if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
    });
  }

  triggerFileInput(type: 'image' | 'video') {
    if (type === 'image' && this.fileInputImage) {
      this.fileInputImage.nativeElement.click();
    } else if (type === 'video' && this.fileInputVideo) {
      this.fileInputVideo.nativeElement.click();
    }
  }

  formatFileSize(size: number): string {
    if (size < 1024) return size + " B";
    else if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
    else if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + " MB";
    else return (size / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  }

  onPreviewLoaded(id: number) {
    const item = this.findById(id);
    if (!item || !item.loading) return;
    this.zone.run(() => {
      if (item.progress < 100) {
        return;
      }
    });
  }
}
