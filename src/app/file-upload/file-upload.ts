import { Component, NgZone, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

interface PreviewFile {
  id: number;
  fileName: string;
  size: number;
  url: string | null;   // object URL for preview
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

  @ViewChild('fileInputImage') fileInputImage!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInputVideo') fileInputVideo!: ElementRef<HTMLInputElement>;

  isDragOver = { image: false, video: false };

  private idCounter = 0;
  private rafHandles = new Map<number, number>(); // keep track of requestAnimationFrame handles

  constructor(private zone: NgZone) {}

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

    const files = Array.from(input.files);

    files.forEach(file => {
      const objectUrl = URL.createObjectURL(file);
      const item: PreviewFile = {
        id: Date.now() + Math.random(),
        fileName: file.name,
        size: file.size,
        url: objectUrl,
        objectUrl,
        progress: 0,
        loading: false
      };
      if (type === 'image') {
        this.images.push(item);
      } else {
        this.videos.push(item);
      }
    });

    // Reset the file input so the same file can be selected again
    input.value = '';
  }

  // --- Core: create objectURL + fake animated progress with RAF ---
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

      const duration = Math.min(1400, 300 + file.size / 1000); // ms
      const start = performance.now();

      const step = (now: number) => {
        const elapsed = now - start;
        let percent = Math.round((elapsed / duration) * 100);
        percent = Math.max(0, Math.min(100, percent));

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
          this.rafHandles.delete(placeholder.id);
        }
      };

      const handle = requestAnimationFrame(step);
      this.rafHandles.set(placeholder.id, handle);
    });
  }

  // Called when image/video preview is loaded
  onPreviewLoaded(id: number) {
    const item = this.findById(id);
    if (!item) return;

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

  // Remove single preview
  removePreview(id: number, event: Event) {
    event.stopPropagation();
    const idxImg = this.images.findIndex(i => i.id === id);
    if (idxImg > -1) {
      const it = this.images.splice(idxImg, 1)[0];
      if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
      const raf = this.rafHandles.get(id);
      if (raf) cancelAnimationFrame(raf);
      this.rafHandles.delete(id);
      this.clearFileInput('image');
      return;
    }

    const idxVid = this.videos.findIndex(v => v.id === id);
    if (idxVid > -1) {
      const it = this.videos.splice(idxVid, 1)[0];
      if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
      const raf = this.rafHandles.get(id);
      if (raf) cancelAnimationFrame(raf);
      this.rafHandles.delete(id);
      this.clearFileInput('video');
    }
  }

  formatFileSize(bytes: number): string {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private findById(id: number) {
    return this.images.find(i => i.id === id) || this.videos.find(v => v.id === id) || null;
  }

  trackById(_i: number, item: PreviewFile) {
    return item.id;
  }

  // Clean up object URLs and RAF on destroy
  ngOnDestroy(): void {
    this.images.concat(this.videos).forEach(it => {
      if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
      const raf = this.rafHandles.get(it.id);
      if (raf) cancelAnimationFrame(raf);
    });
    this.rafHandles.clear();
  }

  // Save all files to localStorage
  uploadAll(type: 'image' | 'video') {
    const items = type === 'image' ? this.images : this.videos;
    if (items.length === 0) return;

    const data = items.map(f => ({
      id: f.id,
      name: f.fileName,
      size: f.size,
      url: f.url
    }));

    localStorage.setItem(this.storageKey(type), JSON.stringify(data));

    // Clear previews after upload
    if (type === 'image') {
      this.images.forEach(it => {
        if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
      });
      this.images = [];
      this.clearFileInput('image');
    } else {
      this.videos.forEach(it => {
        if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
      });
      this.videos = [];
      this.clearFileInput('video');
    }

    alert(`${type === 'image' ? 'Images' : 'Videos'} uploaded to localStorage!`);
  }

  // Remove all previews
  removeAll(type: 'image' | 'video') {
    if (type === 'image') {
      this.images.forEach(it => {
        if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
      });
      this.images = [];
      this.clearFileInput('image');
    } else {
      this.videos.forEach(it => {
        if (it.objectUrl) URL.revokeObjectURL(it.objectUrl);
      });
      this.videos = [];
      this.clearFileInput('video');
    }
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
}
