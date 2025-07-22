import { BaseMiniGame, MiniGameResult, EndConditionResult } from './IMiniGame';
import { MiniGameType } from '../GameState';

// 줄다리기 팀
export enum TugOfWarTeam {
    TEAM_A = "TEAM_A",
    TEAM_B = "TEAM_B"
}

// 줄다리기 게임 액션
export interface TugOfWarAction {
    pullPower: number;    // 당기는 힘 (1-100)
    timestamp: number;    // 액션 시간
}

export class TugOfWarGame extends BaseMiniGame {
    private teamA: string[] = [];
    private teamB: string[] = [];
    private teamAPower: number = 0;
    private teamBPower: number = 0;
    private gameTime: number = 30000; // 30초 게임
    private startTime: number = 0;
    private playerPowers: Map<string, number[]> = new Map(); // 각 플레이어의 파워 기록
    
    constructor() {
        super(MiniGameType.TUG_OF_WAR);
    }
    
    protected onGameStart(): void {
        // 외부에서 팀이 설정되지 않은 경우에만 자동으로 팀 나누기
        if (this.teamA.length === 0 && this.teamB.length === 0) {
            this.divideTeams();
        }
        
        this.startTime = Date.now();
        this.teamAPower = 0;
        this.teamBPower = 0;
        this.playerPowers.clear();
        
        // 각 플레이어의 파워 기록 초기화
        for (const playerId of this.players) {
            this.playerPowers.set(playerId, []);
        }
        
        console.log(`줄다리기 시작: 팀A ${this.teamA.length}명 vs 팀B ${this.teamB.length}명, 게임시간 ${this.gameTime}ms`);
    }
    
    protected onGameEnd(): void {
        console.log(`줄다리기 종료: 팀A 총력 ${this.teamAPower}, 팀B 총력 ${this.teamBPower}`);
    }
    
    // 외부에서 팀 구성을 설정할 수 있는 메서드
    public setTeams(teamA: string[], teamB: string[]): void {
        this.teamA = [...teamA];
        this.teamB = [...teamB];
        console.log(`팀 구성 설정 - 팀A: ${this.teamA.join(', ')}, 팀B: ${this.teamB.join(', ')}`);
    }
    
    private divideTeams(): void {
        // 플레이어를 랜덤하게 두 팀으로 나누기
        const shuffled = [...this.players].sort(() => Math.random() - 0.5);
        const midPoint = Math.ceil(shuffled.length / 2);
        
        this.teamA = shuffled.slice(0, midPoint);
        this.teamB = shuffled.slice(midPoint);
        
        console.log(`팀 구성 - 팀A: ${this.teamA.join(', ')}, 팀B: ${this.teamB.join(', ')}`);
    }
    
    public handlePlayerAction(playerId: string, action: any): boolean {
        if (!this.isActive) {
            return false;
        }
        
        if (!this.players.includes(playerId)) {
            return false;
        }
        
        const currentTime = Date.now();
        const elapsed = currentTime - this.startTime;
        
        // 게임 시간 초과 체크
        if (elapsed > this.gameTime) {
            return false;
        }
        
        const tugAction = action as TugOfWarAction;
        const pullPower = Math.max(0, Math.min(100, tugAction.pullPower)); // 0-100 범위로 제한
        
        // 플레이어의 파워 기록에 추가
        const playerPowerHistory = this.playerPowers.get(playerId) || [];
        playerPowerHistory.push(pullPower);
        this.playerPowers.set(playerId, playerPowerHistory);
        
        // 팀별 총 파워 업데이트
        if (this.teamA.includes(playerId)) {
            this.teamAPower += pullPower;
        } else if (this.teamB.includes(playerId)) {
            this.teamBPower += pullPower;
        }
        
        console.log(`플레이어 ${playerId} 파워: ${pullPower}, 팀A 총력: ${this.teamAPower}, 팀B 총력: ${this.teamBPower}`);
        return true;
    }
    
    protected calculateResult(): MiniGameResult {
        const survivors: string[] = [];
        const eliminated: string[] = [];
        
        // 팀B(오른쪽)가 승리하거나 동점인 경우 팀B 승리
        // 팀A(왼쪽)가 명확히 더 강한 경우에만 팀A 승리
        const isLeftWin = this.teamAPower > this.teamBPower;
        
        if (isLeftWin) {
            // 왼쪽 팀(팀A)이 승리
            survivors.push(...this.teamA);
            eliminated.push(...this.teamB);
        } else {
            // 오른쪽 팀(팀B)이 승리 (동점 포함)
            survivors.push(...this.teamB);
            eliminated.push(...this.teamA);
        }
        
        return {
            gameType: this.gameType,
            eliminatedPlayers: eliminated,
            survivors: survivors,
            gameData: {
                teamA: this.teamA,
                teamB: this.teamB,
                teamAPower: this.teamAPower,
                teamBPower: this.teamBPower,
                winningTeam: this.teamAPower > this.teamBPower ? 'TEAM_A' : 'TEAM_B',  // 동점 시 팀B 승리
                gameTime: this.gameTime,
                playerPowers: Object.fromEntries(this.playerPowers)
            }
        };
    }
    
    public getGameState(): any {
        return {
            ...super.getGameState(),
            teamA: this.teamA,
            teamB: this.teamB,
            teamAPower: this.teamAPower,
            teamBPower: this.teamBPower,
            gameTime: this.gameTime,
            startTime: this.startTime,
            timeRemaining: Math.max(0, this.gameTime - (Date.now() - this.startTime))
        };
    }
    
    // 플레이어가 어느 팀인지 반환
    public getPlayerTeam(playerId: string): TugOfWarTeam | null {
        if (this.teamA.includes(playerId)) {
            return TugOfWarTeam.TEAM_A;
        } else if (this.teamB.includes(playerId)) {
            return TugOfWarTeam.TEAM_B;
        }
        return null;
    }
    
    // 줄다리기는 연결 해제로 게임이 즉시 종료되지 않음
    public checkEndCondition(alivePlayers: string[]): EndConditionResult {
        // 줄다리기 게임은 시간 기반으로만 종료됨
        // 연결 해제로는 게임을 종료시키지 않음
        return { isFinished: false };
    }
} 