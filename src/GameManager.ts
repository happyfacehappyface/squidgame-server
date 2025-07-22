import { GameState, GamePhase, MiniGameType, PlayerStatus } from './GameState';
import { IMiniGame, MiniGameResult, EndConditionResult } from './games/IMiniGame';
import { DalgonaGame } from './games/DalgonaGame';
import { TugOfWarGame } from './games/TugOfWarGame';
import { RedLightGreenLightGame } from './games/RedLightGreenLightGame';

export interface PlayerData {
    id: string;
    name: string;
    status: PlayerStatus;
    eliminatedInRound?: number;
}

export class GameManager {
    private gameState: GameState = GameState.WAITING;
    private gamePhase: GamePhase = GamePhase.REST;
    private currentRound: number = 0;
    private players: Map<string, PlayerData> = new Map();
    private currentMiniGame: IMiniGame | null = null;
    private restTimer: NodeJS.Timeout | null = null;
    private gameTimer: NodeJS.Timeout | null = null;
    private restDuration: number = 3000; // 3초 휴식
    private readyPlayers: Set<string> = new Set(); // 서브게임 준비 완료한 플레이어들
    private playedGames: Set<MiniGameType> = new Set(); // 이미 플레이한 게임들
    private onGameStateChange?: (state: GameState, phase: GamePhase) => void;
    private onPlayerEliminated?: (players: string[]) => void;
    private onGameEnd?: (winner: string | null) => void;
    private onSubGameReady?: () => void; // 모든 플레이어가 서브게임 준비 완료 시 호출
    private onSubGameEnded?: (survivors: string[], eliminated: string[]) => void; // 서브게임 종료 시 호출
    
    constructor() {
        console.log('GameManager 초기화');
    }
    
    // 이벤트 핸들러 설정
    public setEventHandlers(handlers: {
        onGameStateChange?: (state: GameState, phase: GamePhase) => void;
        onPlayerEliminated?: (players: string[]) => void;
        onGameEnd?: (winner: string | null) => void;
        onSubGameReady?: () => void;
        onSubGameEnded?: (survivors: string[], eliminated: string[]) => void;
    }): void {
        this.onGameStateChange = handlers.onGameStateChange;
        this.onPlayerEliminated = handlers.onPlayerEliminated;
        this.onGameEnd = handlers.onGameEnd;
        this.onSubGameReady = handlers.onSubGameReady;
        this.onSubGameEnded = handlers.onSubGameEnded;
    }
    
    // 게임 시작
    public startGame(playerIds: string[], playerNames: string[]): void {
        if (this.gameState !== GameState.WAITING) {
            console.log('게임이 이미 진행 중입니다.');
            return;
        }
        
        // 플레이어 데이터 초기화
        this.players.clear();
        playerIds.forEach((id, index) => {
            this.players.set(id, {
                id,
                name: playerNames[index] || `Player_${id}`,
                status: PlayerStatus.ALIVE
            });
        });
        
        this.gameState = GameState.IN_PROGRESS;
        this.gamePhase = GamePhase.REST;
        this.currentRound = 0;
        
        console.log(`게임 시작: ${this.players.size}명 참여`);
        this.notifyStateChange();
        
        // 첫 번째 휴식 시간 시작
        this.startRestPhase();
    }
    
    // 휴식 시간 시작
    private startRestPhase(): void {
        this.gamePhase = GamePhase.REST;
        this.notifyStateChange();
        
        console.log(`휴식 시간 시작: ${this.restDuration}ms`);
        
        this.restTimer = setTimeout(() => {
            this.startPreparePhase();
        }, this.restDuration);
    }
    
    // 미니게임 준비 페이즈 시작
    private startPreparePhase(): void {
        if (this.restTimer) {
            clearTimeout(this.restTimer);
            this.restTimer = null;
        }
        
        const alivePlayers = this.getAlivePlayers();
        
        // 생존자가 1명 이하면 게임 종료
        if (alivePlayers.length <= 1) {
            this.endGame(alivePlayers[0] || null);
            return;
        }
        
        this.currentRound++;
        this.gamePhase = GamePhase.PREPARE;
        
        // PREPARE 페이즈에서 미니게임 미리 선택 (서버에서 시작 패킷을 보내기 위해)
        const gameType = this.selectRandomMiniGame();
        this.currentMiniGame = this.createMiniGame(gameType);
        
        this.notifyStateChange();
        
        console.log(`${this.currentRound}라운드 준비 시작: ${alivePlayers.length}명 참여`);
        
        // 준비 상태 초기화
        this.readyPlayers.clear();
    }
    
    // 미니게임 시작 (모든 플레이어 준비 완료 후)
    public startCurrentMiniGame(): void {
        if (this.gamePhase !== GamePhase.PREPARE) {
            console.log('현재 PREPARE 페이즈가 아니므로 미니게임을 시작할 수 없습니다.');
            return;
        }
        
        const alivePlayers = this.getAlivePlayers();
        
        this.gamePhase = GamePhase.MINIGAME;
        this.notifyStateChange();
        
        // 미니게임이 이미 PREPARE 페이즈에서 선택되었으므로 바로 시작
        if (!this.currentMiniGame) {
            console.error('미니게임이 선택되지 않았습니다!');
            return;
        }
        
        console.log(`${this.currentRound}라운드 시작: ${this.currentMiniGame.gameType}, ${alivePlayers.length}명 참여`);
        
        // 미니게임 시작
        this.currentMiniGame.start(alivePlayers);
        
        // 게임 시간 제한 설정 (예: 2분)
        this.gameTimer = setTimeout(() => {
            this.endCurrentMiniGame();
        }, 120000); // 2분
    }
    
    // 랜덤 미니게임 선택 (중복 방지)
    private selectRandomMiniGame(): MiniGameType {

        


        // 모든 사용 가능한 게임 타입들을 동적으로 가져오기
        const allGameTypes = Object.values(MiniGameType) as MiniGameType[];

        // FOR DEBUG PURPOSE
        //return allGameTypes[2];
        
        // 아직 플레이하지 않은 게임들만 필터링
        const availableGames = allGameTypes.filter(gameType => !this.playedGames.has(gameType));
        
        // 모든 게임을 플레이했다면 플레이한 게임 기록 초기화하고 다시 시작
        if (availableGames.length === 0) {
            console.log('모든 미니게임을 플레이했습니다. 플레이한 게임 기록을 초기화합니다.');
            this.playedGames.clear();
            return this.selectRandomMiniGame(); // 재귀 호출로 다시 선택
        }
        
        // 사용 가능한 게임 중에서 랜덤 선택
        const randomIndex = Math.floor(Math.random() * availableGames.length);
        const selectedGame = availableGames[randomIndex];
        
        // 선택된 게임을 플레이한 게임 목록에 추가
        this.playedGames.add(selectedGame);
        
        // 게임 이름 매핑
        const gameNameMap: Record<MiniGameType, string> = {
            [MiniGameType.DALGONA]: '달고나',
            [MiniGameType.TUG_OF_WAR]: '줄다리기',
            [MiniGameType.RED_LIGHT_GREEN_LIGHT]: 'Red Light Green Light'
        };
        
        const playedGameNames = Array.from(this.playedGames).map(g => gameNameMap[g]).join(', ');
        console.log(`랜덤 미니게임 선택: ${gameNameMap[selectedGame]} 게임 (총 ${allGameTypes.length}개 중 플레이 완료: ${playedGameNames})`);
        
        return selectedGame;
    }
    
    // 미니게임 인스턴스 생성
    private createMiniGame(gameType: MiniGameType): IMiniGame {
        switch (gameType) {
            case MiniGameType.DALGONA:
                return new DalgonaGame();
            case MiniGameType.TUG_OF_WAR:
                return new TugOfWarGame();
            case MiniGameType.RED_LIGHT_GREEN_LIGHT:
                return new RedLightGreenLightGame();
            default:
                throw new Error(`지원되지 않는 게임 타입: ${gameType}`);
        }
    }
    
    // 현재 미니게임 종료
    public endCurrentMiniGame(): void {
        if (!this.currentMiniGame) {
            return;
        }
        
        if (this.gameTimer) {
            clearTimeout(this.gameTimer);
            this.gameTimer = null;
        }
        
        this.gamePhase = GamePhase.RESULT;
        this.notifyStateChange();
        
        const result = this.currentMiniGame.end();
        this.processGameResult(result);
        
        this.currentMiniGame = null;
        
        // SUBGAME_ENDED 이벤트 호출 후 5초 뒤에 다음 라운드 시작
        if (this.onSubGameEnded) {
            this.onSubGameEnded(result.survivors, result.eliminatedPlayers);
        }
        
        // 5초 후 다음 라운드 시작 또는 게임 종료 판단
        setTimeout(() => {
            const alivePlayers = this.getAlivePlayers();
            if (alivePlayers.length <= 1) {
                // 생존자가 1명 이하면 게임 종료
                this.endGame(alivePlayers[0] || null);
            } else {
                // 생존자가 2명 이상이면 다음 라운드 시작
                this.startRestPhase();
            }
        }, 5000); // 5초 후
    }
    
    // 게임 결과 처리
    private processGameResult(result: MiniGameResult): void {
        console.log(`게임 결과 - 생존: ${result.survivors.length}명, 탈락: ${result.eliminatedPlayers.length}명`);
        
        // 탈락자 처리
        result.eliminatedPlayers.forEach(playerId => {
            const player = this.players.get(playerId);
            if (player) {
                player.status = PlayerStatus.ELIMINATED;
                player.eliminatedInRound = this.currentRound;
            }
        });
        
        // 탈락자가 있으면 알림
        if (result.eliminatedPlayers.length > 0 && this.onPlayerEliminated) {
            this.onPlayerEliminated(result.eliminatedPlayers);
        }
    }
    
    // 플레이어 액션 처리
    public handlePlayerAction(playerId: string, action: any): boolean {
        if (!this.currentMiniGame || this.gamePhase !== GamePhase.MINIGAME) {
            return false;
        }
        
        const player = this.players.get(playerId);
        if (!player || player.status !== PlayerStatus.ALIVE) {
            return false;
        }
        
        return this.currentMiniGame.handlePlayerAction(playerId, action);
    }
    
    // 게임 종료
    private endGame(winnerId: string | null): void {
        this.gameState = GameState.FINISHED;
        this.gamePhase = GamePhase.RESULT;
        
        if (this.restTimer) {
            clearTimeout(this.restTimer);
            this.restTimer = null;
        }
        
        if (this.gameTimer) {
            clearTimeout(this.gameTimer);
            this.gameTimer = null;
        }
        
        console.log(`게임 종료 - 우승자: ${winnerId || '없음'}, 총 ${this.currentRound}라운드`);
        
        this.notifyStateChange();
        
        if (this.onGameEnd) {
            this.onGameEnd(winnerId);
        }
    }
    
    // 상태 변경 알림
    private notifyStateChange(): void {
        if (this.onGameStateChange) {
            this.onGameStateChange(this.gameState, this.gamePhase);
        }
    }
    
    // 생존한 플레이어 ID 목록 반환
    private getAlivePlayers(): string[] {
        return Array.from(this.players.values())
            .filter(player => player.status === PlayerStatus.ALIVE)
            .map(player => player.id);
    }
    
    // 게임 상태 정보 반환
    public getGameInfo(): any {
        const alivePlayers = this.getAlivePlayers();
        const eliminatedPlayers = Array.from(this.players.values())
            .filter(player => player.status === PlayerStatus.ELIMINATED);
        
        return {
            gameState: this.gameState,
            gamePhase: this.gamePhase,
            currentRound: this.currentRound,
            totalPlayers: this.players.size,
            alivePlayers: alivePlayers.length,
            eliminatedPlayers: eliminatedPlayers.length,
            currentMiniGame: this.currentMiniGame?.gameType || null,
            players: Object.fromEntries(this.players)
        };
    }
    
    // 현재 미니게임 상태 반환
    public getCurrentMiniGameState(): any {
        if (!this.currentMiniGame) {
            return null;
        }
        return this.currentMiniGame.getGameState();
    }
    
    // 현재 미니게임 인스턴스 반환 (콜백 설정 등을 위해)
    public getCurrentMiniGameInstance(): IMiniGame | null {
        return this.currentMiniGame;
    }
    
    // 서브게임 준비 완료 설정
    public setPlayerReadyForSubGame(playerId: string): boolean {
        if (this.gameState !== GameState.IN_PROGRESS) {
            return false;
        }
        
        const player = this.players.get(playerId);
        if (!player) {
            return false;
        }
        
        // 죽은 플레이어도 관전을 위해 SubGameReady를 받을 수 있도록 허용
        // 단, 생존 플레이어만 readyPlayers에 추가
        if (player.status === PlayerStatus.ALIVE) {
            this.readyPlayers.add(playerId);
            console.log(`플레이어 ${playerId} 서브게임 준비 완료 (${this.readyPlayers.size}/${this.getAlivePlayers().length})`);
        } else {
            console.log(`플레이어 ${playerId} (탈락자) 서브게임 준비 완료 - 관전 모드`);
        }
        
        // 모든 생존 플레이어가 준비 완료되었는지 확인
        const alivePlayers = this.getAlivePlayers();
        if (this.readyPlayers.size === alivePlayers.length && alivePlayers.length > 0) {
            console.log('모든 플레이어가 서브게임 준비 완료!');
            this.readyPlayers.clear(); // 다음 서브게임을 위해 초기화
            
            if (this.onSubGameReady) {
                this.onSubGameReady();
            }
            
            return true;
        }
        
        return false;
    }
    
    // 서브게임 준비 상태 초기화
    public clearSubGameReadyStatus(): void {
        this.readyPlayers.clear();
        console.log('서브게임 준비 상태 초기화');
    }
    
    // 서브게임 준비 완료된 플레이어 수 반환
    public getReadyPlayersCount(): number {
        return this.readyPlayers.size;
    }

    // 플레이어 탈락 처리 (연결 해제 시)
    public eliminatePlayerByDisconnection(playerId: string): boolean {
        const player = this.players.get(playerId);
        if (!player) {
            console.log(`플레이어 ${playerId}를 찾을 수 없습니다.`);
            return false;
        }
        
        if (player.status !== PlayerStatus.ALIVE) {
            console.log(`플레이어 ${playerId}는 이미 탈락했습니다.`);
            return false;
        }
        
        // 플레이어를 탈락 상태로 변경
        player.status = PlayerStatus.ELIMINATED;
        player.eliminatedInRound = this.currentRound;
        
        // readyPlayers에서도 제거
        this.readyPlayers.delete(playerId);
        
        console.log(`플레이어 ${playerId} (${player.name})가 연결 해제로 인해 탈락했습니다.`);
        
        return true;
    }
    
    // 게임 종료 조건 확인
    private checkGameEndConditions(): void {
        const alivePlayers = Array.from(this.players.values()).filter(p => p.status === PlayerStatus.ALIVE);
        
        if (alivePlayers.length <= 1) {
            console.log(`생존자가 ${alivePlayers.length}명입니다. 게임 종료!`);
            
            // 우승자 결정
            const winner = alivePlayers.length === 1 ? alivePlayers[0].id : null;
            
            // 게임 종료 처리
            this.gameState = GameState.FINISHED;
            this.gamePhase = GamePhase.REST;
            
            // 타이머 정리
            if (this.restTimer) {
                clearTimeout(this.restTimer);
                this.restTimer = null;
            }
            if (this.gameTimer) {
                clearTimeout(this.gameTimer);
                this.gameTimer = null;
            }
            
            // 이벤트 핸들러 호출
            if (this.onGameEnd) {
                this.onGameEnd(winner);
            }
        }
    }
    
    // 서브게임 종료 조건 확인
    private checkSubGameEndConditions(): void {
        if (!this.currentMiniGame) {
            return;
        }
        
        const alivePlayers = Array.from(this.players.values()).filter(p => p.status === PlayerStatus.ALIVE);
        const alivePlayerIds = alivePlayers.map(p => p.id);
        
        // 미니게임 종료 조건 확인
        const gameResult = this.currentMiniGame.checkEndCondition(alivePlayerIds);
        
        if (gameResult.isFinished) {
            console.log('연결 해제로 인한 서브게임 조기 종료 조건 충족!');
            
            // 서브게임 강제 종료
            this.forceEndCurrentMiniGame();
        }
    }
    
    // 현재 미니게임 강제 종료 (연결 해제 등으로 인한)
    private forceEndCurrentMiniGame(): void {
        if (!this.currentMiniGame) {
            return;
        }
        
        console.log('미니게임 강제 종료 처리 중...');
        
        // 현재 생존한 플레이어들
        const alivePlayers = Array.from(this.players.values()).filter(p => p.status === PlayerStatus.ALIVE);
        const alivePlayerIds = alivePlayers.map(p => p.id);
        
        // 미니게임 결과 계산
        const gameResult = this.currentMiniGame.getResult(alivePlayerIds);
        
        // 탈락자 처리
        const eliminatedInThisRound: string[] = [];
        for (const playerId of gameResult.eliminatedPlayers) {
            const player = this.players.get(playerId);
            if (player && player.status === PlayerStatus.ALIVE) {
                player.status = PlayerStatus.ELIMINATED;
                player.eliminatedInRound = this.currentRound;
                eliminatedInThisRound.push(playerId);
            }
        }
        
        if (eliminatedInThisRound.length > 0 && this.onPlayerEliminated) {
            this.onPlayerEliminated(eliminatedInThisRound);
        }
        
        // 서브게임 종료 이벤트 호출
        const survivors = gameResult.survivors;
        if (this.onSubGameEnded) {
            this.onSubGameEnded(survivors, eliminatedInThisRound);
        }
        
        // 미니게임 정리
        this.currentMiniGame = null;
        this.readyPlayers.clear();
        
        // 게임 종료 조건 재확인
        this.checkGameEndConditions();
        
        // 게임이 아직 끝나지 않았다면 다음 라운드 준비
        if (this.gameState === GameState.IN_PROGRESS) {
            this.gamePhase = GamePhase.RESULT;
            
            // 5초 후 다음 라운드 시작
            this.restTimer = setTimeout(() => {
                this.startNextRound();
            }, 5000);
        }
    }
    
    // 다음 라운드 시작
    private startNextRound(): void {
        if (this.gameState !== GameState.IN_PROGRESS) {
            return;
        }
        
        // 생존자 확인
        const alivePlayers = this.getAlivePlayers();
        if (alivePlayers.length <= 1) {
            console.log('다음 라운드 시작 불가: 생존자가 1명 이하입니다.');
            this.checkGameEndConditions();
            return;
        }
        
        console.log(`다음 라운드 시작 - 생존자 ${alivePlayers.length}명`);
        
        // 다음 라운드로 진행
        this.currentRound++;
        this.startRestPhase();
    }
    
    // 게임 리셋
    public resetGame(): void {
        if (this.restTimer) {
            clearTimeout(this.restTimer);
            this.restTimer = null;
        }
        
        if (this.gameTimer) {
            clearTimeout(this.gameTimer);
            this.gameTimer = null;
        }
        
        this.gameState = GameState.WAITING;
        this.gamePhase = GamePhase.REST;
        this.currentRound = 0;
        this.players.clear();
        this.currentMiniGame = null;
        this.readyPlayers.clear();
        this.playedGames.clear(); // 플레이한 게임 기록도 초기화
        
        console.log('게임 리셋 완료');
    }
} 