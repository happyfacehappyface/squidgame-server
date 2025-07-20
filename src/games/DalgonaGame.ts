import { BaseMiniGame, MiniGameResult } from './IMiniGame';
import { MiniGameType } from '../GameState';

// 달고나 모양 타입
export enum DalgonaShape {
    CIRCLE = "CIRCLE",
    TRIANGLE = "TRIANGLE", 
    STAR = "STAR",
    UMBRELLA = "UMBRELLA"
}

// 달고나 게임 액션
export interface DalgonaAction {
    success: boolean;   // 모양 뽑기 성공 여부
    timeTaken: number;  // 소요 시간 (밀리초)
}

export class DalgonaGame extends BaseMiniGame {
    private gameShape: DalgonaShape = DalgonaShape.CIRCLE;
    private timeLimit: number = 60000; // 60초 제한
    private startTime: number = 0;
    
    constructor() {
        super(MiniGameType.DALGONA);
    }
    
    protected onGameStart(): void {
        // 랜덤한 달고나 모양 선택
        const shapes = Object.values(DalgonaShape);
        this.gameShape = shapes[Math.floor(Math.random() * shapes.length)];
        this.startTime = Date.now();
        
        console.log(`달고나 게임 시작: 모양 = ${this.gameShape}, 제한시간 = ${this.timeLimit}ms`);
    }
    
    protected onGameEnd(): void {
        console.log(`달고나 게임 종료: ${this.playerResults.size}명이 결과를 제출했습니다.`);
    }
    
    public handlePlayerAction(playerId: string, action: any): boolean {
        if (!this.isActive) {
            return false;
        }
        
        if (!this.players.includes(playerId)) {
            return false;
        }
        
        if (this.playerResults.has(playerId)) {
            return false; // 이미 결과 제출함
        }
        
        const dalgonaAction = action as DalgonaAction;
        const currentTime = Date.now();
        const elapsed = currentTime - this.startTime;
        
        // 제한시간 초과 체크
        if (elapsed > this.timeLimit) {
            dalgonaAction.success = false;
        }
        
        this.playerResults.set(playerId, {
            success: dalgonaAction.success,
            timeTaken: dalgonaAction.timeTaken,
            submittedAt: currentTime
        });
        
        console.log(`플레이어 ${playerId} 달고나 결과: ${dalgonaAction.success ? '성공' : '실패'}`);
        return true;
    }
    
    protected calculateResult(): MiniGameResult {
        const survivors: string[] = [];
        const eliminated: string[] = [];
        
        // 결과를 제출하지 않은 플레이어는 자동으로 탈락
        for (const playerId of this.players) {
            const result = this.playerResults.get(playerId);
            
            if (!result || !result.success) {
                eliminated.push(playerId);
            } else {
                survivors.push(playerId);
            }
        }
        
        return {
            gameType: this.gameType,
            eliminatedPlayers: eliminated,
            survivors: survivors,
            gameData: {
                shape: this.gameShape,
                timeLimit: this.timeLimit,
                results: Object.fromEntries(this.playerResults)
            }
        };
    }
    
    public getGameState(): any {
        return {
            ...super.getGameState(),
            gameShape: this.gameShape,
            timeLimit: this.timeLimit,
            startTime: this.startTime,
            submissions: this.playerResults.size
        };
    }
} 