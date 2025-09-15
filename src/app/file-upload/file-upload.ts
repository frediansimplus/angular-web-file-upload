import { Component, NgZone, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

interface PreviewFile {
  id: number;
  fileName: string;
  size: number;
  url: string | null;       // object URL untuk preview
  objectUrl?: string;
  loading: boolean;
  progress: number;
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
  isDragOver = { image: false, video: false };

  private idCounter = 0;
  private rafHandles = new Map<number, number>(); // simpan handle RAF untuk cancel
  private storageKey(type: 'image' | 'video') {
    return type === 'image' ? 'uploaded_images' : 'uploaded_videos';
  }

  constructor(private zone: NgZone) {}

  // --- Drag/drop handlers (tidak berubah) ---
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
    if (input.files) this.handleFiles(input.files, type);
  }

  // --- core: create objectURL + fake animated progress via RAF ---
  handleFiles(files: FileList, type: 'image' | 'video') {
    Array.from(files).forEach(file => {
      const id = ++this.idCounter;
      const objectUrl = URL.createObjectURL(file);

      const placeholder: PreviewFile = {
        id,
        fileName: file.name,
        size: file.size,
        url: objectUrl,
        objectUrl,
        loading: true,
        progress: 0
      };

      if (type === 'image') this.images.push(placeholder);
      else this.videos.push(placeholder);

      // Duration kecil untuk file kecil, lebih lama untuk file lebih besar (kasual)
      const duration = Math.min(1400, 300 + file.size / 1000); // ms
      const start = performance.now();

      const step = (now: number) => {
        console.log("---------------------")
        console.log("PROGRESS start", start)
        console.log("PROGRESS now", now)
        console.log("PROGRESS DUR", duration)
        console.log("PROGRESS", placeholder.progress)
        const elapsed = now - start;
        console.log("elapsed", elapsed)
        let percent = Math.round((elapsed / duration) * 100);
        percent = Math.max(0, Math.min(100, percent));
        console.log("PERCENT", percent)

        // pastikan Angular tahu perubahan (zone.run)
        this.zone.run(() => {
          placeholder.progress = percent;
          if (type === 'image') {
            this.images = [...this.images];
          } else {
            this.videos = [...this.videos];
          }
        });

        if (percent < 100) {
          const handle = requestAnimationFrame(step);
          this.rafHandles.set(placeholder.id, handle);
        } else {
          // reached 100% animasi; kita tetap menunggu event load() media untuk hide overlay.
          this.rafHandles.delete(placeholder.id);
        }
      };

      const handle = requestAnimationFrame(step);
      this.rafHandles.set(placeholder.id, handle);
    });
  }

  // dipanggil oleh (load) pada <img> atau (loadeddata) pada <video>
  onPreviewLoaded(id: number) {
    const item = this.findById(id);
    if (!item) return;

    // cancel RAF kalau masih ada
    const raf = this.rafHandles.get(id);
    if (raf) {
      cancelAnimationFrame(raf);
      this.rafHandles.delete(id);
    }

    this.zone.run(() => {
      item.progress = 100;
      item.loading = false;
    });
  }

  // remove preview (optional utility)
  removePreview(id: number, event: Event) {
    event.stopPropagation();
    const idxImg = this.images.findIndex(i => i.id === id);
    if (idxImg > -1) {
      const it = this.images.splice(idxImg, 1)[0];
      if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
      const raf = this.rafHandles.get(id);
      if (raf) cancelAnimationFrame(raf);
      this.rafHandles.delete(id);
      return;
    }

    const idxVid = this.videos.findIndex(v => v.id === id);
    if (idxVid > -1) {
      const it = this.videos.splice(idxVid, 1)[0];
      if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
      const raf = this.rafHandles.get(id);
      if (raf) cancelAnimationFrame(raf);
      this.rafHandles.delete(id);
    }
  }

  formatFileSize(bytes: number): string {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // helper
  private findById(id: number) {
    return this.images.find(i => i.id === id) || this.videos.find(v => v.id === id) || null;
  }

  trackById(_i: number, item: PreviewFile) {
    return item.id;
  }

  // revoke any remaining object URLs on destroy
  ngOnDestroy(): void {
    this.images.concat(this.videos).forEach(it => {
      if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
      const raf = this.rafHandles.get(it.id);
      if (raf) cancelAnimationFrame(raf);
    });
    this.rafHandles.clear();
  }
  
  // Simpan semua file ke localStorage
  uploadAll(type: 'image' | 'video') {
    const items = type === 'image' ? this.images : this.videos;
    if (items.length === 0) return;

    // Simpan data ke localStorage
    const data = items.map(f => ({
      id: f.id,
      name: f.fileName,
      size: f.size,
      url: f.url
    }));

    localStorage.setItem(this.storageKey(type), JSON.stringify(data));
    alert(`${type === 'image' ? 'Images' : 'Videos'} uploaded to localStorage!`);
  }

  // Hapus semua preview
  removeAll(type: 'image' | 'video') {
    if (type === 'image') {
      this.images.forEach(it => {
        if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
      });
      this.images = [];
    } else {
      this.videos.forEach(it => {
        if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
      });
      this.videos = [];
    }
  }
}
