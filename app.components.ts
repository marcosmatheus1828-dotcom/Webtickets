import { Component, OnInit } from '@angular/core';
import { QueueService } from './queue.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {

  state$ = this.queue.state$;
  interval: any;

  constructor(private queue: QueueService) {}

  ngOnInit() {
    this.interval = setInterval(() => {
      this.queue.tick();
    }, 1000);
  }

  emit(type: any) {
    this.queue.emitTicket(type);
  }

  toggle() {
    this.queue.toggleRun();
  }

  reset() {
    this.queue.reset();
  }
}