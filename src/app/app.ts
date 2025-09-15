import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FileUpload } from './file-upload/file-upload'; 

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, FileUpload],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('angular-web-file-upload');
}
