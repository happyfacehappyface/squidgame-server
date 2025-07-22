import { BaseMiniGame, MiniGameResult, EndConditionResult } from './IMiniGame';
import { MiniGameType } from '../GameState';

// Red Light Green Light 게임 액션
export interface RedLightGreenLightAction {
    success: boolean;   // 게임 성공 여부 (도착지 도달)
    timeTaken: number;  // 소요 시간 (밀리초)
}

// 신호등 상태 변화 콜백
export interface LightChangeCallback {
    (redLightOn: boolean): void;
}

// 플레이어 결과 브로드캐스트 콜백  
export interface PlayerResultCallback {
    (playerIndex: number, isSuccess: boolean): void;
}

// 플레이어 위치 브로드캐스트 콜백 (0~1000 범위의 int 배열, -1은 탈락/완료)
export interface PlayerPositionCallback {
    (progressArray: number[]): void;
}

// 게임 종료 브로드캐스트 콜백
export interface GameEndCallback {
    (): void;
}

// GameManager에게 게임 종료 요청 콜백
export interface RequestGameEndCallback {
    (): void;
}

export class RedLightGreenLightGame extends BaseMiniGame {
    private timeLimit: number = 30000; // 30초 제한
    private startTime: number = 0;
    private redLightOn: boolean = false; // 초록불로 시작 (첫 변화가 빨간불이 되도록)
    private lightChangeTimer: NodeJS.Timeout | null = null;
    private gameTimer: NodeJS.Timeout | null = null;
    private positionBroadcastInterval: NodeJS.Timeout | null = null;
    
    // 콜백 함수들
    private onLightChange?: LightChangeCallback;
    private onPlayerResult?: PlayerResultCallback;
    private onPlayerPosition?: PlayerPositionCallback;
    private onGameEndBroadcast?: GameEndCallback;
    private onRequestGameEnd?: RequestGameEndCallback; // GameManager에게 게임 종료 요청
    private playerIndexMap: Map<string, number> = new Map(); // playerId -> playerIndex
    
    // 플레이어 위치 추적
    private playerPositions: Map<string, number> = new Map(); // playerId -> progress (0~1000)
    
    // 게임 종료 관련
    private gameEnded: boolean = false;
    
    constructor() {
        super(MiniGameType.RED_LIGHT_GREEN_LIGHT);
    }
    
    // 콜백 설정
    public setCallbacks(callbacks: {
        onLightChange?: LightChangeCallback;
        onPlayerResult?: PlayerResultCallback;
        onPlayerPosition?: PlayerPositionCallback;
        onGameEndBroadcast?: GameEndCallback;
        onRequestGameEnd?: RequestGameEndCallback;
        playerIndexMap: Map<string, number>;
    }): void {
        this.onLightChange = callbacks.onLightChange;
        this.onPlayerResult = callbacks.onPlayerResult;
        this.onPlayerPosition = callbacks.onPlayerPosition;
        this.onGameEndBroadcast = callbacks.onGameEndBroadcast;
        this.onRequestGameEnd = callbacks.onRequestGameEnd;
        this.playerIndexMap = callbacks.playerIndexMap;
    }
    
    protected onGameStart(): void {
        this.startTime = Date.now();
        this.redLightOn = false; // 초록불로 시작 (첫 변화가 빨간불이 되도록)
        this.gameEnded = false;
        this.clearTimers();
        
        // 플레이어 위치 초기화 (모든 플레이어 0에서 시작)
        this.playerPositions.clear();
        for (const playerId of this.players) {
            this.playerPositions.set(playerId, 0);
        }
        
        console.log(`Red Light Green Light 게임 시작: 제한시간 = ${this.timeLimit}ms, 참여자 ${this.players.length}명`);
        
        // 게임 종료 타이머 설정
        this.gameTimer = setTimeout(() => {
            this.forceEnd();
        }, this.timeLimit);
        
        // 신호등 변화 시작
        this.scheduleNextLightChange();
        
        // 위치 브로드캐스트 시작 (0.5초마다)
        this.startPositionBroadcast();
    }
    
    protected onGameEnd(): void {
        this.clearTimers();
        console.log(`Red Light Green Light 게임 종료: ${this.playerResults.size}명이 결과를 제출했습니다.`);
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
        
        const rlglAction = action as RedLightGreenLightAction;
        const currentTime = Date.now();
        const elapsed = currentTime - this.startTime;
        
        // 제한시간 초과 체크
        if (elapsed > this.timeLimit) {
            rlglAction.success = false;
        }
        
        this.playerResults.set(playerId, {
            success: rlglAction.success,
            timeTaken: rlglAction.timeTaken,
            submittedAt: currentTime
        });
        
        console.log(`플레이어 ${playerId} Red Light Green Light 결과: ${rlglAction.success ? '성공' : '실패'}`);
        
        // 플레이어 결과 브로드캐스트
        console.log(`[DEBUG] 브로드캐스트 준비: playerId=${playerId}, onPlayerResult exists=${!!this.onPlayerResult}, playerIndexMap size=${this.playerIndexMap.size}`);
        
        if (this.onPlayerResult) {
            console.log(`[DEBUG] playerId 타입과 값: "${playerId}" (타입: ${typeof playerId}, 길이: ${playerId.length})`);
            
            // 키 값 비교 디버깅
            const mapKeys = Array.from(this.playerIndexMap.keys());
            console.log(`[DEBUG] playerIndexMap 키들:`, mapKeys.map(key => `"${key}" (타입: ${typeof key}, 길이: ${key.length})`));
            
            // Map.get() 시도
            let playerIndex = this.playerIndexMap.get(playerId);
            
            // Map.get()이 실패하면 수동 검색으로 대체
            if (playerIndex === undefined) {
                console.log(`[DEBUG] Map.get() 실패, 수동 검색 시작: playerId="${playerId}"`);
                
                for (const [key, value] of this.playerIndexMap.entries()) {
                    if (key === playerId) {
                        playerIndex = value;
                        console.log(`[DEBUG] 수동 검색 성공: "${key}" -> ${value}`);
                        break;
                    }
                }
                
                if (playerIndex === undefined) {
                    playerIndex = -1;
                    console.error(`[DEBUG] 수동 검색도 실패: playerId="${playerId}"`);
                    console.log(`[DEBUG] 현재 playerIndexMap:`, Array.from(this.playerIndexMap.entries()));
                }
            }
            
            console.log(`[DEBUG] 최종 playerIndex: ${playerIndex}`);
            
            if (playerIndex !== -1 && playerIndex !== undefined) {
                console.log(`[DEBUG] onPlayerResult 콜백 호출: playerIndex=${playerIndex}, success=${rlglAction.success}`);
                this.onPlayerResult(playerIndex, rlglAction.success);
            } else {
                console.error(`[DEBUG] 브로드캐스트 실패: 플레이어 ${playerId}의 인덱스를 찾을 수 없음`);
                console.log(`[DEBUG] 현재 playerIndexMap:`, Array.from(this.playerIndexMap.entries()));
            }
        } else {
            console.error(`[DEBUG] 브로드캐스트 실패: onPlayerResult 콜백이 설정되지 않음`);
        }
        
        // 모든 플레이어가 결과를 제출했는지 체크
        this.checkAllPlayersSubmitted();
        
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
                timeLimit: this.timeLimit,
                results: Object.fromEntries(this.playerResults)
            }
        };
    }
    
    public getGameState(): any {
        return {
            ...super.getGameState(),
            timeLimit: this.timeLimit,
            startTime: this.startTime,
            redLightOn: this.redLightOn,
            submissions: this.playerResults.size
        };
    }
    
    // Red Light Green Light 게임 종료 조건
    public checkEndCondition(alivePlayers: string[]): EndConditionResult {
        // 생존자가 1명 이하면 즉시 종료
        if (alivePlayers.length <= 1) {
            return {
                isFinished: true,
                reason: alivePlayers.length === 0 ? 'No players remaining' : 'Only one player remaining'
            };
        }
        
        // 모든 생존 플레이어가 결과를 제출했으면 종료
        const aliveSubmissions = alivePlayers.filter(playerId => this.playerResults.has(playerId));
        if (aliveSubmissions.length === alivePlayers.length) {
            return {
                isFinished: true,
                reason: 'All alive players submitted results'
            };
        }
        
        return { isFinished: false };
    }
    
    // 신호등 변화 스케줄링
    private scheduleNextLightChange(): void {
        if (!this.isActive) {
            return;
        }
        
        // 이미 타이머가 설정되어 있다면 중복 실행 방지
        if (this.lightChangeTimer) {
            console.log('신호등 변화 타이머가 이미 실행 중입니다. 중복 실행을 방지합니다.');
            return;
        }
        
        // 3~6초 사이의 랜덤한 시간 (3000ms ~ 6000ms)
        const randomDelay = Math.floor(Math.random() * 3001) + 3000; // 3000 + (0~3000)
        
        this.lightChangeTimer = setTimeout(() => {
            this.lightChangeTimer = null; // 타이머 정리
            this.changeLightState();
            this.scheduleNextLightChange(); // 다음 변화 스케줄링
        }, randomDelay);
        
        console.log(`다음 신호등 변화까지 ${randomDelay}ms`);
    }
    
    // 신호등 상태 변경
    private changeLightState(): void {
        if (!this.isActive) {
            return;
        }
        
        // redLightOn 상태를 번갈아가며 변경
        this.redLightOn = !this.redLightOn;
        
        console.log(`신호등 변화: ${this.redLightOn ? '빨간불 ON' : '초록불 ON'}`);
        
        // 콜백을 통해 브로드캐스트
        if (this.onLightChange) {
            this.onLightChange(this.redLightOn);
        }
    }
    
    // 강제 게임 종료 (시간 초과)
    private forceEnd(): void {
        if (!this.isActive || this.gameEnded) {
            return;
        }
        
        console.log('Red Light Green Light 게임 제한시간 종료!');
        
        // 아직 결과를 제출하지 않은 플레이어들은 자동으로 실패 처리
        for (const playerId of this.players) {
            if (!this.playerResults.has(playerId)) {
                console.log(`플레이어 ${playerId}는 시간 내에 결과를 제출하지 않아 자동 실패 처리됩니다.`);
                this.playerResults.set(playerId, {
                    success: false,
                    timeTaken: this.timeLimit,
                    submittedAt: Date.now()
                });
                
                // 플레이어 결과 브로드캐스트
                if (this.onPlayerResult) {
                    const playerIndex = this.playerIndexMap.get(playerId) || -1;
                    if (playerIndex !== -1) {
                        this.onPlayerResult(playerIndex, false);
                    }
                }
            }
        }
        
        // 시간 종료로 인한 게임 종료 브로드캐스트
        this.endGameWithBroadcast();
    }
    
    // 타이머 정리
    private clearTimers(): void {
        if (this.lightChangeTimer) {
            clearTimeout(this.lightChangeTimer);
            this.lightChangeTimer = null;
        }
        if (this.gameTimer) {
            clearTimeout(this.gameTimer);
            this.gameTimer = null;
        }
        if (this.positionBroadcastInterval) {
            clearInterval(this.positionBroadcastInterval);
            this.positionBroadcastInterval = null;
        }
    }
    
    // 위치 브로드캐스트 시작 (0.5초마다)
    private startPositionBroadcast(): void {
        if (!this.isActive) {
            return;
        }
        
        // 즉시 한 번 브로드캐스트
        this.broadcastPlayerPositions();
        
        // 0.5초마다 브로드캐스트
        this.positionBroadcastInterval = setInterval(() => {
            if (this.isActive) {
                this.broadcastPlayerPositions();
            }
        }, 500); // 500ms = 0.5초
        
        console.log('플레이어 위치 브로드캐스트 시작 (0.5초 주기)');
    }
    
    // 모든 플레이어 위치 브로드캐스트
    private broadcastPlayerPositions(): void {
        if (!this.onPlayerPosition) {
            return;
        }
        
        // 플레이어 인덱스별로 정렬된 배열 생성 (인덱스 0부터 차례대로)
        const maxPlayerIndex = Math.max(...Array.from(this.playerIndexMap.values()));
        const progressArray: number[] = new Array(maxPlayerIndex + 1).fill(-1); // 기본값 -1로 초기화
        
        // 각 플레이어의 상태에 따라 progress 값 설정
        for (const [clientId, playerIndex] of this.playerIndexMap.entries()) {
            const playerResult = this.playerResults.get(clientId);
            
            if (playerResult) {
                // 이미 게임 결과를 제출한 플레이어는 -1 (게임 완료)
                progressArray[playerIndex] = -1;
            } else if (this.players.includes(clientId)) {
                // 현재 게임 중인 생존 플레이어는 실제 위치 (0~1000)
                const progress = this.playerPositions.get(clientId) || 0;
                progressArray[playerIndex] = Math.max(0, Math.min(1000, progress)); // 0~1000 범위로 제한
            } else {
                // 탈락했거나 연결이 끊어진 플레이어는 -1
                progressArray[playerIndex] = -1;
            }
        }
        
        console.log(`플레이어 위치 브로드캐스트: [${progressArray.join(', ')}] (총 ${progressArray.length}명)`);
        
        // 콜백을 통해 브로드캐스트
        this.onPlayerPosition(progressArray);
    }
    
    // 플레이어 위치 업데이트
    public updatePlayerPosition(playerId: string, progress: number): boolean {
        if (!this.isActive) {
            return false;
        }
        
        if (!this.players.includes(playerId)) {
            return false;
        }
        
        // 이미 결과를 제출한 플레이어는 위치 업데이트 불가
        if (this.playerResults.has(playerId)) {
            return false;
        }
        
        // progress를 0~1000 범위로 제한
        const clampedProgress = Math.max(0, Math.min(1000, Math.floor(progress)));
        this.playerPositions.set(playerId, clampedProgress);
        
        console.log(`플레이어 ${playerId} 위치 업데이트: ${clampedProgress}/1000`);
        return true;
    }
    
    // 모든 플레이어가 결과를 제출했는지 체크
    private checkAllPlayersSubmitted(): void {
        if (this.gameEnded || !this.isActive) {
            return;
        }
        
        // 현재 게임 중인 생존 플레이어 수 계산
        const alivePlayersCount = this.players.length;
        const submittedCount = this.playerResults.size;
        
        console.log(`결과 제출 상황: ${submittedCount}/${alivePlayersCount}명 제출 완료`);
        
        // 모든 생존 플레이어가 결과를 제출했으면 게임 종료
        if (submittedCount === alivePlayersCount && alivePlayersCount > 0) {
            console.log('모든 플레이어가 결과를 제출했습니다! 게임 종료');
            this.endGameWithBroadcast();
        }
    }
    
    // 게임 종료 조건 체크 (절반 이상 성공) - 사용하지 않음
    private checkGameEndCondition(): void {
        if (this.gameEnded || !this.isActive) {
            return;
        }
        
        // 성공한 플레이어 수 계산
        let successCount = 0;
        for (const [playerId, result] of this.playerResults.entries()) {
            if (result && result.success) {
                successCount++;
            }
        }
        
        const totalPlayers = this.players.length;
        const halfPlayers = Math.ceil(totalPlayers / 2); // 절반 이상 (올림)
        
        console.log(`게임 종료 조건 체크: 성공 ${successCount}명 / 전체 ${totalPlayers}명 (필요: ${halfPlayers}명)`);
        
        if (successCount >= halfPlayers) {
            console.log('절반 이상의 플레이어가 성공! 게임 종료');
            this.endGameWithBroadcast();
        }
    }
    
    // 게임 종료 처리 (브로드캐스트 포함)
    private endGameWithBroadcast(): void {
        if (this.gameEnded) {
            return;
        }
        
        this.gameEnded = true;
        
        console.log('Red Light Green Light 게임 종료 - 게임 타이머 정리 및 결과 브로드캐스트 시작');
        
        // 게임 시간제한 타이머 종료
        if (this.gameTimer) {
            clearTimeout(this.gameTimer);
            this.gameTimer = null;
            console.log('게임 시간제한 타이머 종료됨');
        }
        
        // 모든 타이머 정리
        this.clearTimers();
        
        // RedLightGreenLightGameEnded 패킷 브로드캐스트 (REDLIGHTGREENLIGHT_GAME_RESULT)
        if (this.onGameEndBroadcast) {
            this.onGameEndBroadcast();
        }
        
        // 잠시 후 GameManager를 통해 게임 종료 요청 (SUBGAME_ENDED)
        console.log(`[DEBUG] 3초 후 GameManager에게 게임 종료 요청 예약됨, 현재 isActive: ${this.isActive}`);
        
        setTimeout(() => {
            console.log(`[DEBUG] 3초 후 콜백 실행됨, isActive: ${this.isActive}, gameEnded: ${this.gameEnded}`);
            
            if (this.isActive && this.onRequestGameEnd) {
                console.log('GameManager에게 게임 종료 요청 - SUBGAME_ENDED 브로드캐스트 예정');
                this.onRequestGameEnd();
            } else if (!this.isActive) {
                console.log(`[DEBUG] isActive가 false이므로 게임 종료 요청 취소됨`);
            } else if (!this.onRequestGameEnd) {
                console.log(`[DEBUG] onRequestGameEnd 콜백이 설정되지 않음 - 직접 end() 호출`);
                this.end();
            }
        }, 3000); // 3초 후 GameManager에게 게임 종료 요청
    }
    
    // 게임 시작할 때 미니게임 페이즈에서 호출할 메서드
    public startLightChanges(): void {
        if (this.isActive) {
            console.log('startLightChanges() 호출됨 - 신호등 변화 시작 시도');
            this.scheduleNextLightChange();
        } else {
            console.log('startLightChanges() 호출됨 - 게임이 비활성 상태이므로 무시');
        }
    }
    
    // 게임 정리 (외부에서 호출용)
    public cleanup(): void {
        this.clearTimers();
        this.isActive = false;
    }
    
    // 현재 신호등 상태 반환
    public getCurrentLightState(): boolean {
        return this.redLightOn;
    }
    
    // 현재 모든 플레이어의 위치 배열 반환 (개별 응답용)
    public getCurrentPlayerPositions(): number[] {
        if (!this.playerIndexMap || this.playerIndexMap.size === 0) {
            return [];
        }
        
        // 플레이어 인덱스별로 정렬된 배열 생성 (인덱스 0부터 차례대로)
        const maxPlayerIndex = Math.max(...Array.from(this.playerIndexMap.values()));
        const progressArray: number[] = new Array(maxPlayerIndex + 1).fill(-1); // 기본값 -1로 초기화
        
        // 각 플레이어의 상태에 따라 progress 값 설정
        for (const [clientId, playerIndex] of this.playerIndexMap.entries()) {
            const playerResult = this.playerResults.get(clientId);
            
            if (playerResult) {
                // 이미 게임 결과를 제출한 플레이어는 -1 (게임 완료)
                progressArray[playerIndex] = -1;
            } else if (this.players.includes(clientId)) {
                // 현재 게임 중인 생존 플레이어는 실제 위치 (0~1000)
                const progress = this.playerPositions.get(clientId) || 0;
                progressArray[playerIndex] = Math.max(0, Math.min(1000, progress)); // 0~1000 범위로 제한
            } else {
                // 탈락했거나 연결이 끊어진 플레이어는 -1
                progressArray[playerIndex] = -1;
            }
        }
        
        return progressArray;
    }
} 