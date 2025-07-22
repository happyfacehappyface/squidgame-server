import * as WebSocket from 'ws';
import { IncomingMessage } from 'http';

export interface ClientInfo {
    id: string;
    ip: string;
    connectedAt: number;
    isInRoom: boolean;
    roomId: string | null;
    playerName: string | null;
    isAlive: boolean;
}

export class Client {
    public readonly ws: WebSocket;
    public readonly id: string;
    public readonly ip: string;
    public readonly connectedAt: number;
    public isInRoom: boolean;
    public roomId: string | null;
    public playerName: string | null;
    public isAlive: boolean;

    constructor(ws: WebSocket, req: IncomingMessage) {
        this.ws = ws;
        this.id = this.generateId();
        this.ip = req.socket.remoteAddress || 'unknown';
        this.connectedAt = Date.now();
        this.isInRoom = false;
        this.roomId = null;
        this.playerName = null;
        this.isAlive = true;
    }

    // 고유 ID 생성
    private generateId(): string {
        return Math.random().toString(36).substr(2, 9);
    }

    // 방 참여
    public joinRoom(roomId: string, playerName: string): void {
        this.isInRoom = true;
        this.roomId = roomId;
        this.playerName = playerName;
        console.log(`클라이언트 ${this.id}가 방 ${roomId}에 참여했습니다.`);
    }

    // 방 나가기
    public leaveRoom(): void {
        if (this.isInRoom) {
            console.log(`클라이언트 ${this.id}가 방 ${this.roomId}에서 나갔습니다.`);
        }
        this.isInRoom = false;
        this.roomId = null;
        this.playerName = null;
    }

    // 메시지 전송 (성능 최적화)
    public send(message: any): void {
        if (this.ws.readyState === WebSocket.OPEN) {
            try {
                // 이미 문자열인 경우 그대로 전송, 객체인 경우 JSON.stringify
                const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
                this.ws.send(messageStr);
            } catch (error) {
                console.error(`클라이언트 ${this.id} 메시지 전송 실패:`, error);
            }
        }
    }

    // 연결 해제
    public disconnect(): void {
        this.isAlive = false;
        this.leaveRoom();
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }
    }

    // 클라이언트 정보 가져오기
    public getInfo(): ClientInfo {
        return {
            id: this.id,
            ip: this.ip,
            connectedAt: this.connectedAt,
            isInRoom: this.isInRoom,
            roomId: this.roomId,
            playerName: this.playerName,
            isAlive: this.isAlive
        };
    }

    // 연결 시간 (초)
    public getConnectionTime(): number {
        return Math.floor((Date.now() - this.connectedAt) / 1000);
    }
} 