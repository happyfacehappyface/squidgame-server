import express from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';
import { Client } from './Client';
import { RoomManager } from './RoomManager';
import { RoomStatus } from './Room';
import { GameManager } from './GameManager';
import { GameState, GamePhase, PlayerStatus } from './GameState';
import { RedLightGreenLightGame } from './games/RedLightGreenLightGame';

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ 
    server: server,
    path: '/ws'
});

app.set('port', 8082);

// 클라이언트 관리
const clients = new Map<string, Client>(); // clientId -> Client 객체

// RoomManager 인스턴스 생성
const roomManager = new RoomManager();

// GameManager 인스턴스 생성
const gameManager = new GameManager();

// 달고나 게임 결과 추적 (clientId -> isSuccess)
const dalgonaGameResults = new Map<string, boolean>();
let dalgonaGameTimer: NodeJS.Timeout | null = null;

// 줄다리기 게임 상태 추적
let tugOfWarLeftTeam: number[] = [];
let tugOfWarRightTeam: number[] = [];
let tugOfWarLeftTeamScore = 0;
let tugOfWarRightTeamScore = 0;
let tugOfWarGameInterval: NodeJS.Timeout | null = null;
let tugOfWarGameTimer: NodeJS.Timeout | null = null;

// Red Light Green Light 게임 상태 추적 (호환성을 위해 유지, 추후 제거 예정)
let redLightGreenLightTimer: NodeJS.Timeout | null = null;
let redLightGreenLightGameTimer: NodeJS.Timeout | null = null;
let redLightOn = true; // 처음은 빨간불로 시작

// GameManager 이벤트 핸들러 설정
gameManager.setEventHandlers({
    onGameStateChange: (state: GameState, phase: GamePhase) => {
        console.log(`게임 상태 변경: ${GameState[state]} - ${GamePhase[phase]}`);
        
        // 미니게임 준비 페이즈가 시작되면 선택된 게임에 따라 시작 패킷 전송
        if (state === GameState.IN_PROGRESS && phase === GamePhase.PREPARE) {
            const gameInfo = gameManager.getGameInfo();
            const currentGameType = gameInfo.currentMiniGame;
            
            console.log(`PREPARE 페이즈 - 현재 미니게임 타입: ${currentGameType}`);
            
            if (currentGameType === 'TUG_OF_WAR') {
                startTugOfWarGame();
            } else if (currentGameType === 'DALGONA') {
                startDalgonaGame();
            } else if (currentGameType === 'RED_LIGHT_GREEN_LIGHT') {
                startRedLightGreenLightGameFromClass();
            } else {
                console.log(`알 수 없는 게임 타입: ${currentGameType} - 게임 시작 패킷을 전송하지 않습니다.`);
            }
        }
        
        // 실제 미니게임 페이즈가 시작되면 게임 타입에 따라 인터벌 시작
        if (state === GameState.IN_PROGRESS && phase === GamePhase.MINIGAME) {
            const gameInfo = gameManager.getGameInfo();
            const currentGameType = gameInfo.currentMiniGame;
            
            if (currentGameType === 'TUG_OF_WAR') {
                startTugOfWarGameInterval();
            } else if (currentGameType === 'RED_LIGHT_GREEN_LIGHT') {
                startRedLightGreenLightIntervalFromClass();
            }
            // 달고나 게임은 별도 인터벌이 필요없음 (클라이언트 독립 실행)
        }
        
        // 미니게임이 끝나면 모든 게임 타이머와 인터벌 정리
        if (phase !== GamePhase.MINIGAME) {
            // 달고나 게임 타이머 정리
            if (dalgonaGameTimer) {
                clearTimeout(dalgonaGameTimer);
                dalgonaGameTimer = null;
            }
            // 줄다리기 게임 인터벌과 타이머 정리
            if (tugOfWarGameInterval) {
                clearInterval(tugOfWarGameInterval);
                tugOfWarGameInterval = null;
            }
            if (tugOfWarGameTimer) {
                clearTimeout(tugOfWarGameTimer);
                tugOfWarGameTimer = null;
            }
            // Red Light Green Light 게임 타이머 정리
            if (redLightGreenLightTimer) {
                clearTimeout(redLightGreenLightTimer);
                redLightGreenLightTimer = null;
            }
            if (redLightGreenLightGameTimer) {
                clearTimeout(redLightGreenLightGameTimer);
                redLightGreenLightGameTimer = null;
            }
            console.log('모든 미니게임 타이머와 인터벌 정리 완료');
        }
    },
    onPlayerEliminated: (eliminatedPlayers: string[]) => {
        console.log(`플레이어 탈락: ${eliminatedPlayers.join(', ')}`);
        // 탈락 알림 패킷 전송 (추후 구현)
    },
    onGameEnd: (winnerId: string | null) => {
        console.log(`게임 종료: 우승자 ${winnerId || '없음'}`);
        
        // 모든 게임 타이머와 인터벌 정리
        if (dalgonaGameTimer) {
            clearTimeout(dalgonaGameTimer);
            dalgonaGameTimer = null;
        }
        if (tugOfWarGameInterval) {
            clearInterval(tugOfWarGameInterval);
            tugOfWarGameInterval = null;
        }
        if (tugOfWarGameTimer) {
            clearTimeout(tugOfWarGameTimer);
            tugOfWarGameTimer = null;
        }
        if (redLightGreenLightTimer) {
            clearTimeout(redLightGreenLightTimer);
            redLightGreenLightTimer = null;
        }
        if (redLightGreenLightGameTimer) {
            clearTimeout(redLightGreenLightGameTimer);
            redLightGreenLightGameTimer = null;
        }
        console.log('게임 종료 - 모든 미니게임 타이머와 인터벌 정리 완료');
        
        // 우승자의 플레이어 인덱스 구하기
        let winnerPlayerIndex = -1;
        if (winnerId) {
            winnerPlayerIndex = roomManager.getPlayerIndex(winnerId);
        }
        
        // 모든 플레이어에게 GAME_ENDED 응답 전송
        roomManager.broadcast({
            code: ResponseCode.SUCCESS,
            signal: ResponseSignal.GAME_ENDED,
            data: {
                winnerPlayerIndex: winnerPlayerIndex
            }
        });
        
        console.log(`게임 종료 패킷 브로드캐스트 완료: 우승자 플레이어 인덱스 ${winnerPlayerIndex}`);
        
        // 5초 후 방 초기화 (플레이어들이 결과를 확인할 시간 제공)
        setTimeout(() => {
            resetGameRoom();
        }, 5000);
    },
    onSubGameReady: () => {
        console.log('모든 플레이어가 서브게임 준비 완료! ResponseReadySubGame 브로드캐스트');
        // 모든 플레이어에게 READY_SUBGAME 응답 브로드캐스트
        roomManager.broadcast({
            code: ResponseCode.SUCCESS,
            signal: ResponseSignal.READY_SUBGAME,
            data: {}
        });
        
        // 실제 미니게임 시작
        gameManager.startCurrentMiniGame();
    },
    onSubGameEnded: (survivors: string[], eliminated: string[]) => {
        console.log(`서브게임 종료: 생존자 ${survivors.length}명, 탈락자 ${eliminated.length}명`);
        
        // 생존자들의 플레이어 인덱스 계산
        const survivePlayerIndices = survivors.map(playerId => 
            roomManager.getPlayerIndex(playerId)
        ).filter(index => index !== -1);
        
        // 모든 플레이어에게 SUBGAME_ENDED 브로드캐스트
        roomManager.broadcast({
            code: ResponseCode.SUCCESS,
            signal: ResponseSignal.SUBGAME_ENDED,
            data: {
                survivePlayerIndices: survivePlayerIndices
            }
        });
        
        console.log(`SUBGAME_ENDED 브로드캐스트 완료: 생존자 ${survivePlayerIndices.length}명 (인덱스: ${survivePlayerIndices.join(', ')})`);
        console.log('5초 후 다음 라운드 시작 또는 게임 종료 예정');
    }
});

// Signal 번호 정의 (Request)
const RequestSignal = {
    PING: 1,
    ENTER_ROOM: 1001,
    LEAVE_ROOM: 1002,
    START_GAME: 1004,
    READY_GAME: 1005,

    READY_SUBGAME: 2001,

    DALGONA_GAME_RESULT: 2102,

    TUGOFWAR_GAME_PRESS_COUNT: 2202,

    REDLIGHTGREENLIGHT_PLAYER_RESULT: 2303,
    REDLIGHTGREENLIGHT_PLAYER_POSITION: 2304,

} as const;

// Signal 번호 정의 (Response)
const ResponseSignal = {
    PING: 1,
    ENTER_ROOM: 1001,
    LEAVE_ROOM: 1002,
    PLAYER_COUNT_CHANGED: 1003,
    START_GAME: 1004,
    READY_GAME: 1005,

    READY_SUBGAME: 2001,
    SUBGAME_ENDED: 2002,
    GAME_ENDED: 2003,

    DALGONA_GAME_STARTED: 2101,
    DALGONA_GAME_RESULT: 2102,

    TUGOFWAR_GAME_STARTED: 2201,
    TUGOFWAR_GAME_PRESS_COUNT: 2202,
    TUGOFWAR_GAME_RESULT: 2203,

    REDLIGHTGREENLIGHT_GAME_STARTED: 2301,

    REDLIGHTGREENLIGHT_LIGHT_CHANGED: 2302,

    REDLIGHTGREENLIGHT_PLAYER_RESULT: 2303,

    REDLIGHTGREENLIGHT_PLAYER_POSITION: 2304,
    REDLIGHTGREENLIGHT_GAME_RESULT: 2305,

} as const;

const ResponseCode = {
    SUCCESS: 0,
    ERROR: 1,
} as const;

// 패킷 타입 정의
interface RequestPacket {
    signal: number;
    data: any;
}

interface ResponsePacket {
    code: number;
    signal: number;
    data: any;
}

// Request 패킷 데이터 형식 (참고용)
// RequestEnterRoom: { playerName: string }
// RequestLeaveRoom: {}
// RequestStartGame: {}
// RequestReadyGame: {}
// RequestReadySubGame: {}
// RequestDalgonaGameResult: { isSuccess: boolean }
// RequestTugOfWarGamePressCount: { pressCount: number }

// Response 패킷 생성 함수
function createResponse(code: number, signal: number, data: any = {}): ResponsePacket {
    return {
        code: code,
        signal: signal,
        data: data
    };
}

function createSuccessResponse(signal: number, data: any = {}): ResponsePacket {
    return createResponse(ResponseCode.SUCCESS, signal, data);
}

function createErrorResponse(signal: number, data: any = {}): ResponsePacket {
    return createResponse(ResponseCode.ERROR, signal, data);
}

// 패킷 전송 함수
function sendResponse(client: Client, response: ResponsePacket): void {
    client.send(response);
}

function handlePing(client: Client, data: any): void {
    console.log('PING 수신:', client.id);
    
    // PING 응답 전송 (지연시간 포함)
    sendResponse(client, createSuccessResponse(ResponseSignal.PING, {
        serverTime: Date.now(),
        clientTime: data.clientTime,
        latency: Date.now() - data.clientTime
    }));
    
    console.log('PING 응답 전송 완료');
}

function handleEnterRoom(client: Client, data: any): void {
    console.log('ENTER_ROOM 요청 수신:', client.id, 'data:', data);
    
    // 요청 데이터 검증
    if (!data || typeof data.playerName !== 'string' || data.playerName.trim() === '') {
        console.log(`클라이언트 ${client.id} 입장 실패: 플레이어 이름이 없거나 올바르지 않음`);
        sendResponse(client, createErrorResponse(ResponseSignal.ENTER_ROOM, {
            message: '올바른 플레이어 이름을 입력해주세요.',
            errorCode: 'INVALID_PLAYER_NAME'
        }));
        return;
    }
    
    // 플레이어 이름 길이 제한 (예: 최대 20자)
    const playerName = data.playerName.trim();
    if (playerName.length > 20) {
        console.log(`클라이언트 ${client.id} 입장 실패: 플레이어 이름이 너무 김 (${playerName.length}자)`);
        sendResponse(client, createErrorResponse(ResponseSignal.ENTER_ROOM, {
            message: '플레이어 이름은 20자 이하로 입력해주세요.',
            errorCode: 'PLAYER_NAME_TOO_LONG'
        }));
        return;
    }
    
    // 방 입장 가능 조건 확인
    // 1. 해당 플레이어가 이미 방에 입장한 상태가 아님
    if (roomManager.hasClient(client.id)) {
        console.log(`클라이언트 ${client.id}는 이미 방에 입장해있습니다.`);
        sendResponse(client, createErrorResponse(ResponseSignal.ENTER_ROOM, {
            message: '이미 방에 입장해있습니다.',
            errorCode: 'ALREADY_IN_ROOM'
        }));
        return;
    }
    
    // 2. 방이 가득차지 않았음
    if (roomManager.isFull()) {
        console.log(`클라이언트 ${client.id} 입장 실패: 방이 가득참`);
        sendResponse(client, createErrorResponse(ResponseSignal.ENTER_ROOM, {
            message: '방이 가득 찼습니다.',
            errorCode: 'ROOM_FULL'
        }));
        return;
    }
    
    // 3. 대기 상태에서만 입장 가능
    if (roomManager.globalRoom.status !== RoomStatus.WAITING) {
        console.log(`클라이언트 ${client.id} 입장 실패: 게임이 진행 중이거나 부팅 중`);
        sendResponse(client, createErrorResponse(ResponseSignal.ENTER_ROOM, {
            message: '게임이 진행 중이거나 시작 준비 중입니다.',
            errorCode: 'GAME_NOT_WAITING'
        }));
        return;
    }
    
    // 방 입장 처리 (클라이언트가 전송한 playerName 사용)
    const success = roomManager.addClient(client, playerName);
    
    if (success) {
        console.log(`클라이언트 ${client.id} (${playerName}) 방 입장 성공`);
        
        // 성공 응답 (data는 빈 객체)
        sendResponse(client, createSuccessResponse(ResponseSignal.ENTER_ROOM, {}));
        
        // 모든 플레이어들에게 플레이어 수 변경 알림 (입장한 플레이어 포함)
        roomManager.broadcast({
            code: ResponseCode.SUCCESS,
            signal: ResponseSignal.PLAYER_COUNT_CHANGED,
            data: {
                playerCount: roomManager.getPlayerCount()
            }
        });
        
    } else {
        console.log(`클라이언트 ${client.id} (${playerName}) 방 입장 실패`);
        sendResponse(client, createErrorResponse(ResponseSignal.ENTER_ROOM, {
            message: '방 입장에 실패했습니다.',
            errorCode: 'ENTER_FAILED'
        }));
    }
}

function handleLeaveRoom(client: Client, data: any): void {
    console.log('LEAVE_ROOM 요청 수신:', client.id);
    
    // 방에서 나갈 수 있는 조건 확인
    // 해당 클라이언트가 방에 입장한 상태인지 확인
    if (!roomManager.hasClient(client.id)) {
        console.log(`클라이언트 ${client.id}는 방에 입장해있지 않습니다.`);
        sendResponse(client, createErrorResponse(ResponseSignal.LEAVE_ROOM, {
            message: '방에 입장해있지 않습니다.',
            errorCode: 'NOT_IN_ROOM'
        }));
        return;
    }
    
    // 방에서 나가기 처리
    const success = roomManager.removeClient(client.id);
    
    if (success) {
        console.log(`클라이언트 ${client.id} 방 퇴장 성공`);
        
        // 성공 응답 (data는 빈 객체)
        sendResponse(client, createSuccessResponse(ResponseSignal.LEAVE_ROOM, {}));
        
        // 모든 플레이어들에게 플레이어 수 변경 알림 (퇴장한 플레이어 포함)
        roomManager.broadcast({
            code: ResponseCode.SUCCESS,
            signal: ResponseSignal.PLAYER_COUNT_CHANGED,
            data: {
                playerCount: roomManager.getPlayerCount()
            }
        });
        
    } else {
        console.log(`클라이언트 ${client.id} 방 퇴장 실패`);
        sendResponse(client, createErrorResponse(ResponseSignal.LEAVE_ROOM, {
            message: '방 퇴장에 실패했습니다.',
            errorCode: 'LEAVE_FAILED'
        }));
    }
}

// START_GAME 패킷 처리
function handleStartGame(client: Client): void {
    console.log(`클라이언트 ${client.id}가 게임 시작을 요청했습니다.`);
    
    // 클라이언트가 방에 있는지 확인
    if (!client.isInRoom) {
        console.log(`클라이언트 ${client.id} 게임 시작 실패: 방에 참여하지 않음`);
        sendResponse(client, createErrorResponse(ResponseSignal.START_GAME, {
            message: '방에 참여하지 않은 상태에서는 게임을 시작할 수 없습니다.',
            errorCode: 'NOT_IN_ROOM'
        }));
        return;
    }

    // 이미 게임이 시작되었는지 확인
    if (roomManager.globalRoom.status !== RoomStatus.WAITING) {
        console.log(`클라이언트 ${client.id} 게임 시작 실패: 게임이 이미 시작됨`);
        sendResponse(client, createErrorResponse(ResponseSignal.START_GAME, {
            message: '게임이 이미 시작되었습니다.',
            errorCode: 'GAME_ALREADY_STARTED'
        }));
        return;
    }

    // 게임 부팅 시작
    console.log('게임 부팅 시작: 모든 플레이어에게 START_GAME 응답 전송');
    
    // 룸 상태를 BOOTING으로 변경
    roomManager.startBooting();
    
    // 모든 플레이어 이름 가져오기
    const playerNames = roomManager.getPlayerNames();
    
    // 방에 속한 모든 플레이어에게 START_GAME 응답 전송
    const allClients = roomManager.getAllClients();
    allClients.forEach(targetClient => {
        const myIndex = roomManager.getPlayerIndex(targetClient.id);
        
        sendResponse(targetClient, createSuccessResponse(ResponseSignal.START_GAME, {
            myIndex: myIndex,
            names: playerNames
        }));
    });
}

// READY_GAME 패킷 처리
function handleReadyGame(client: Client): void {
    console.log(`클라이언트 ${client.id}가 게임 준비 완료를 요청했습니다.`);
    
    // 클라이언트가 방에 있는지 확인
    if (!client.isInRoom) {
        console.log(`클라이언트 ${client.id} 게임 준비 실패: 방에 참여하지 않음`);
        sendResponse(client, createErrorResponse(ResponseSignal.READY_GAME, {
            message: '방에 참여하지 않은 상태에서는 게임 준비를 할 수 없습니다.',
            errorCode: 'NOT_IN_ROOM'
        }));
        return;
    }

    // 게임이 BOOTING 상태인지 확인
    if (roomManager.globalRoom.status !== RoomStatus.BOOTING) {
        console.log(`클라이언트 ${client.id} 게임 준비 실패: 게임이 BOOTING 상태가 아님`);
        sendResponse(client, createErrorResponse(ResponseSignal.READY_GAME, {
            message: '게임이 부팅 상태가 아닙니다.',
            errorCode: 'GAME_NOT_BOOTING'
        }));
        return;
    }

    // 클라이언트 준비 완료 설정
    roomManager.setClientReady(client.id);
    
    console.log(`클라이언트 ${client.id} 준비 완료 (${roomManager.getReadyCount()}/${roomManager.getPlayerCount()})`);

    // 모든 클라이언트가 준비 완료되었는지 확인
    if (roomManager.areAllClientsReady()) {
        console.log('모든 플레이어 준비 완료! 메인 게임을 시작합니다.');
        
        // 룸 상태를 PLAYING으로 변경
        roomManager.startGame();
        
        // GameManager로 실제 게임 시작
        const playerIds = roomManager.getAllClientIds();
        const playerNames = roomManager.getPlayerNames();
        gameManager.startGame(playerIds, playerNames);
        
        // 모든 플레이어에게 READY_GAME 응답 전송
        roomManager.broadcast({
            code: ResponseCode.SUCCESS,
            signal: ResponseSignal.READY_GAME,
            data: {}
        });
    }
}

// READY_SUBGAME 패킷 처리
function handleReadySubGame(client: Client): void {
    console.log(`클라이언트 ${client.id}가 서브게임 준비 완료를 요청했습니다.`);
    
    // 클라이언트가 방에 있는지 확인
    if (!client.isInRoom) {
        console.log(`클라이언트 ${client.id} 서브게임 준비 실패: 방에 참여하지 않음`);
        sendResponse(client, createErrorResponse(ResponseSignal.READY_SUBGAME, {
            message: '방에 참여하지 않은 상태에서는 서브게임 준비를 할 수 없습니다.',
            errorCode: 'NOT_IN_ROOM'
        }));
        return;
    }

    // 게임이 진행 중인지 확인
    const gameInfo = gameManager.getGameInfo();
    if (gameInfo.gameState !== GameState.IN_PROGRESS) {
        console.log(`클라이언트 ${client.id} 서브게임 준비 실패: 메인 게임이 진행 중이 아님`);
        sendResponse(client, createErrorResponse(ResponseSignal.READY_SUBGAME, {
            message: '메인 게임이 진행 중이 아닙니다.',
            errorCode: 'GAME_NOT_IN_PROGRESS'
        }));
        return;
    }

    // PREPARE 페이즈에서만 허용
    if (gameInfo.gamePhase !== GamePhase.PREPARE) {
        console.log(`클라이언트 ${client.id} 서브게임 준비 실패: PREPARE 페이즈가 아님 (현재: ${GamePhase[gameInfo.gamePhase]})`);
        sendResponse(client, createErrorResponse(ResponseSignal.READY_SUBGAME, {
            message: '현재 서브게임 준비 단계가 아닙니다.',
            errorCode: 'NOT_PREPARE_PHASE'
        }));
        return;
    }

    // GameManager에 서브게임 준비 완료 알림
    const allReady = gameManager.setPlayerReadyForSubGame(client.id);
    
    if (allReady) {
        // 모든 플레이어가 준비 완료된 경우, onSubGameReady 이벤트에서 브로드캐스트 처리됨
        console.log(`클라이언트 ${client.id} 서브게임 준비 완료 - 모든 플레이어 준비 완료!`);
    } else {
        // 아직 모든 플레이어가 준비되지 않은 경우, 개별 성공 응답
        console.log(`클라이언트 ${client.id} 서브게임 준비 완료 - 다른 플레이어 대기 중`);
        sendResponse(client, createSuccessResponse(ResponseSignal.READY_SUBGAME, {
            message: '서브게임 준비 완료. 다른 플레이어를 기다리는 중입니다.'
        }));
    }
}

// 달고나 게임 시작
function startDalgonaGame(): void {
    console.log('달고나 게임 시작!');
    
    // 달고나 게임 결과 추적 초기화
    dalgonaGameResults.clear();
    
    // 기존 타이머가 있다면 정리
    if (dalgonaGameTimer) {
        clearTimeout(dalgonaGameTimer);
        dalgonaGameTimer = null;
    }
    
    // 달고나 게임의 제한시간 (60초 = 60000ms)
    const timeLimitMs = 60000;
    
    // 모든 플레이어에게 DALGONA_GAME_STARTED 응답 전송
    roomManager.broadcast({
        code: ResponseCode.SUCCESS,
        signal: ResponseSignal.DALGONA_GAME_STARTED,
        data: {
            timeLimitMs: timeLimitMs
        }
    });
    
    // 60초 후 자동으로 게임 종료
    dalgonaGameTimer = setTimeout(() => {
        finishDalgonaGame();
    }, timeLimitMs);
    
    console.log(`달고나 게임 시작 패킷 전송 완료 (제한시간: ${timeLimitMs}ms)`);
}

// 달고나 게임 종료 및 결과 처리
function finishDalgonaGame(): void {
    console.log('달고나 게임 제한시간 종료! 결과 처리 중...');
    
    // 타이머 정리
    if (dalgonaGameTimer) {
        clearTimeout(dalgonaGameTimer);
        dalgonaGameTimer = null;
    }
    
    // 아직 결과를 제출하지 않은 플레이어들은 자동으로 실패 처리
    const allPlayerIds = roomManager.getAllClientIds();
    for (const playerId of allPlayerIds) {
        if (!dalgonaGameResults.has(playerId)) {
            console.log(`플레이어 ${playerId}는 시간 내에 결과를 제출하지 않아 자동 실패 처리됩니다.`);
            dalgonaGameResults.set(playerId, false);
            
            // 해당 플레이어의 인덱스 가져오기
            const playerIndex = roomManager.getPlayerIndex(playerId);
            if (playerIndex !== -1) {
                // 모든 플레이어에게 해당 플레이어의 실패 결과 브로드캐스트
                roomManager.broadcast({
                    code: ResponseCode.SUCCESS,
                    signal: ResponseSignal.DALGONA_GAME_RESULT,
                    data: {
                        playerIndex: playerIndex,
                        isSuccess: false
                    }
                });
            }
        }
    }
    
    console.log(`달고나 게임 시간 종료 처리 완료: 총 ${dalgonaGameResults.size}명의 결과 처리됨`);
    
    // GameManager에게 미니게임 종료 알림 (탈락 처리를 위해)
    setTimeout(() => {
        gameManager.endCurrentMiniGame();
    }, 2000); // 2초 후 게임 종료 (플레이어들이 결과를 확인할 시간 제공)
}

// 줄다리기 게임 시작
function startTugOfWarGame(): void {
    console.log('줄다리기 게임 시작!');
    
    // 줄다리기 게임의 제한시간 (30초 = 30000ms)
    const timeLimitMs = 30000;
    
    // 생존한 플레이어들의 ID와 인덱스 가져오기
    const gameInfo = gameManager.getGameInfo();
    const alivePlayers = gameInfo.players;
    const alivePlayerIds = Object.keys(alivePlayers).filter(playerId => 
        alivePlayers[playerId].status === PlayerStatus.ALIVE
    );
    
    // 생존한 플레이어들의 인덱스 가져오기
    const alivePlayerIndices = alivePlayerIds.map(playerId => 
        roomManager.getPlayerIndex(playerId)
    ).filter(index => index !== -1); // 유효하지 않은 인덱스 제거
    
    // 플레이어를 랜덤으로 섞기
    const shuffledIndices = [...alivePlayerIndices].sort(() => Math.random() - 0.5);
    
    // 팀 나누기
    const leftTeamPlayerIndex: number[] = [];
    const rightTeamPlayerIndex: number[] = [];
    let unearnedWinPlayerIndex: number[] = [];
    
    // 홀수면 한 명을 자동 승리자로 설정
    if (shuffledIndices.length % 2 === 1) {
        unearnedWinPlayerIndex = [shuffledIndices.pop()!];
    }
    
    // 나머지 플레이어들을 절반씩 나누기
    const halfSize = Math.floor(shuffledIndices.length / 2);
    leftTeamPlayerIndex.push(...shuffledIndices.slice(0, halfSize));
    rightTeamPlayerIndex.push(...shuffledIndices.slice(halfSize));
    
    // 모든 플레이어에게 TUGOFWAR_GAME_STARTED 응답 전송
    roomManager.broadcast({
        code: ResponseCode.SUCCESS,
        signal: ResponseSignal.TUGOFWAR_GAME_STARTED,
        data: {
            timeLimitMs: timeLimitMs,
            leftTeamPlayerIndex: leftTeamPlayerIndex,
            rightTeamPlayerIndex: rightTeamPlayerIndex,
            unearnedWinPlayerIndex: unearnedWinPlayerIndex
        }
    });
    
    // 줄다리기 게임 상태 초기화
    tugOfWarLeftTeam = leftTeamPlayerIndex;
    tugOfWarRightTeam = rightTeamPlayerIndex;
    tugOfWarLeftTeamScore = 0;
    tugOfWarRightTeamScore = 0;
    
    // 기존 타이머가 있다면 정리
    if (tugOfWarGameTimer) {
        clearTimeout(tugOfWarGameTimer);
    }
    
    console.log(`줄다리기 게임 시작 패킷 전송 완료 (제한시간: ${timeLimitMs}ms)`);
    console.log(`왼쪽 팀: [${leftTeamPlayerIndex.join(', ')}]`);
    console.log(`오른쪽 팀: [${rightTeamPlayerIndex.join(', ')}]`);
    console.log(`자동 승리: [${unearnedWinPlayerIndex.join(', ')}]`);
}

// 줄다리기 게임 인터벌 시작 (MINIGAME 페이즈에서 호출)
function startTugOfWarGameInterval(): void {
    console.log('줄다리기 게임 실시간 점수 브로드캐스트 시작');
    
    // 기존 인터벌과 타이머가 있다면 정리
    if (tugOfWarGameInterval) {
        clearInterval(tugOfWarGameInterval);
    }
    if (tugOfWarGameTimer) {
        clearTimeout(tugOfWarGameTimer);
    }
    
    // 매 1초마다 팀 간 점수 차이를 브로드캐스트
    tugOfWarGameInterval = setInterval(() => {
        const deltaPressCount = tugOfWarLeftTeamScore - tugOfWarRightTeamScore;
        
        roomManager.broadcast({
            code: ResponseCode.SUCCESS,
            signal: ResponseSignal.TUGOFWAR_GAME_PRESS_COUNT,
            data: {
                deltaPressCount: deltaPressCount
            }
        });
        
        console.log(`줄다리기 점수 차이 브로드캐스트: ${deltaPressCount} (왼쪽: ${tugOfWarLeftTeamScore}, 오른쪽: ${tugOfWarRightTeamScore})`);
    }, 1000); // 1초마다
    
    // 30초 후 게임 결과 전송
    tugOfWarGameTimer = setTimeout(() => {
        finishTugOfWarGame();
    }, 30000); // 30초 = 30000ms
    
    console.log('줄다리기 게임 30초 타이머 시작');
}

// 줄다리기 게임 종료 및 결과 브로드캐스트
function finishTugOfWarGame(): void {
    console.log('줄다리기 게임 제한시간 종료! 결과 계산 중...');
    
    // 최종 점수 차이 계산
    const deltaPressCount = tugOfWarLeftTeamScore - tugOfWarRightTeamScore;
    const isLeftWin = deltaPressCount > 0;
    
    // 모든 플레이어에게 TUGOFWAR_GAME_RESULT 응답 전송
    roomManager.broadcast({
        code: ResponseCode.SUCCESS,
        signal: ResponseSignal.TUGOFWAR_GAME_RESULT,
        data: {
            deltaPressCount: deltaPressCount,
            isLeftWin: isLeftWin
        }
    });
    
    // 인터벌과 타이머 정리
    if (tugOfWarGameInterval) {
        clearInterval(tugOfWarGameInterval);
        tugOfWarGameInterval = null;
    }
    if (tugOfWarGameTimer) {
        clearTimeout(tugOfWarGameTimer);
        tugOfWarGameTimer = null;
    }
    
    console.log(`줄다리기 게임 결과 브로드캐스트 완료`);
    console.log(`최종 점수 차이: ${deltaPressCount} (왼쪽: ${tugOfWarLeftTeamScore}, 오른쪽: ${tugOfWarRightTeamScore})`);
    if (deltaPressCount === 0) {
        console.log(`승리 팀: 오른쪽 팀 (무승부 시 오른쪽 팀 승리 규칙)`);
    } else {
        console.log(`승리 팀: ${isLeftWin ? '왼쪽 팀' : '오른쪽 팀'}`);
    }
    
    // GameManager에게 미니게임 종료 알림 (탈락 처리를 위해)
    setTimeout(() => {
        gameManager.endCurrentMiniGame();
    }, 2000); // 2초 후 게임 종료 (플레이어들이 결과를 확인할 시간 제공)
}

// 기존 Red Light Green Light 함수들은 RedLightGreenLightGame 클래스로 이동됨

// Red Light Green Light 게임 시작 (클래스 사용)
function startRedLightGreenLightGameFromClass(): void {
    console.log('Red Light Green Light 게임 시작! (클래스 버전)');
    
    // 현재 미니게임 인스턴스 가져오기
    const currentMiniGame = gameManager.getCurrentMiniGameState();
    if (!currentMiniGame || currentMiniGame.gameType !== 'RED_LIGHT_GREEN_LIGHT') {
        console.error('Red Light Green Light 게임 인스턴스를 찾을 수 없습니다!');
        return;
    }
    
    // 플레이어 ID -> 인덱스 매핑 생성
    const playerIndexMap = new Map<string, number>();
    const allClientIds = roomManager.getAllClientIds();
    console.log(`[DEBUG] playerIndexMap 설정 시작: 총 ${allClientIds.length}명의 클라이언트`);
    
    allClientIds.forEach(clientId => {
        const playerIndex = roomManager.getPlayerIndex(clientId);
        if (playerIndex !== -1) {
            playerIndexMap.set(clientId, playerIndex);
            console.log(`[DEBUG] 플레이어 매핑: ${clientId} -> 인덱스 ${playerIndex}`);
        } else {
            console.log(`[DEBUG] 플레이어 인덱스 없음: ${clientId}`);
        }
    });
    
    console.log(`[DEBUG] playerIndexMap 설정 완료: 총 ${playerIndexMap.size}명 매핑`);
    
    // GameManager에서 실제 게임 인스턴스 가져오기 (추후 개선 필요)
    const gameInfo = gameManager.getGameInfo();
    const redLightGreenLightGame = gameManager.getCurrentMiniGameInstance();
    
    if (redLightGreenLightGame instanceof RedLightGreenLightGame) {
        // 콜백 설정
        redLightGreenLightGame.setCallbacks({
            onLightChange: (redLightOn: boolean) => {
                // 신호등 변화 브로드캐스트
                roomManager.broadcast({
                    code: ResponseCode.SUCCESS,
                    signal: ResponseSignal.REDLIGHTGREENLIGHT_LIGHT_CHANGED,
                    data: {
                        redLightOn: redLightOn
                    }
                });
                console.log(`신호등 변화 브로드캐스트: ${redLightOn ? '빨간불 ON' : '초록불 ON'}`);
            },
            onPlayerResult: (playerIndex: number, isSuccess: boolean) => {
                // 플레이어 결과 브로드캐스트
                console.log(`[DEBUG] onPlayerResult 콜백 실행: playerIndex=${playerIndex}, isSuccess=${isSuccess}`);
                
                roomManager.broadcast({
                    code: ResponseCode.SUCCESS,
                    signal: ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_RESULT,
                    data: {
                        playerIndex: playerIndex,
                        isSuccess: isSuccess
                    }
                });
                
                console.log(`[DEBUG] 브로드캐스트 전송 완료: 플레이어 ${playerIndex} - ${isSuccess ? '성공' : '실패'}`);
                console.log(`플레이어 결과 브로드캐스트: 플레이어 ${playerIndex} - ${isSuccess ? '성공' : '실패'}`);
            },
            onPlayerPosition: (progressArray: number[]) => {
                // 모든 플레이어 위치 브로드캐스트
                roomManager.broadcast({
                    code: ResponseCode.SUCCESS,
                    signal: ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_POSITION,
                    data: {
                        progress: progressArray
                    }
                });
                console.log(`플레이어 위치 브로드캐스트: [${progressArray.map(p => p.toFixed(2)).join(', ')}]`);
            },
            onGameEndBroadcast: () => {
                // Red Light Green Light 게임 종료 브로드캐스트
                roomManager.broadcast({
                    code: ResponseCode.SUCCESS,
                    signal: ResponseSignal.REDLIGHTGREENLIGHT_GAME_RESULT,
                    data: {}
                });
                console.log('Red Light Green Light 게임 종료 브로드캐스트 완료');
            },
            onRequestGameEnd: () => {
                // GameManager를 통해 게임 종료 (SUBGAME_ENDED 브로드캐스트)
                console.log('Red Light Green Light 게임에서 GameManager에게 게임 종료 요청');
                gameManager.endCurrentMiniGame();
            },
            playerIndexMap: playerIndexMap
        });
    }
    
    // 게임 시작 패킷 전송
    const timeLimitMs = 60000;
    roomManager.broadcast({
        code: ResponseCode.SUCCESS,
        signal: ResponseSignal.REDLIGHTGREENLIGHT_GAME_STARTED,
        data: {
            timeLimitMs: timeLimitMs
        }
    });
    
    console.log(`Red Light Green Light 게임 시작 패킷 전송 완료 (제한시간: ${timeLimitMs}ms)`);
}

// Red Light Green Light 게임 신호등 변화 시작 (클래스 사용)
function startRedLightGreenLightIntervalFromClass(): void {
    console.log('Red Light Green Light 신호등 변화 시작! (클래스 버전)');
    
    // 현재 미니게임 인스턴스 가져오기
    const redLightGreenLightGame = gameManager.getCurrentMiniGameInstance();
    
    if (redLightGreenLightGame instanceof RedLightGreenLightGame) {
        // 신호등 변화는 이미 onGameStart()에서 시작되므로 여기서는 로그만 출력
        console.log('Red Light Green Light 신호등 변화는 게임 시작 시 자동으로 활성화됨');
    } else {
        console.error('Red Light Green Light 게임 인스턴스를 찾을 수 없습니다!');
    }
}

// Red Light Green Light 게임 플레이어 결과 처리
function handleRedLightGreenLightPlayerResult(client: Client, data: any): void {
    console.log(`클라이언트 ${client.id}가 Red Light Green Light 게임 결과를 전송했습니다.`);
    
    // 클라이언트가 방에 있는지 확인
    if (!client.isInRoom) {
        console.log(`클라이언트 ${client.id} Red Light Green Light 결과 전송 실패: 방에 참여하지 않음`);
        sendResponse(client, createErrorResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_RESULT, {
            message: '방에 참여하지 않은 상태에서는 게임 결과를 전송할 수 없습니다.',
            errorCode: 'NOT_IN_ROOM'
        }));
        return;
    }

    // 게임이 진행 중인지 확인
    const gameInfo = gameManager.getGameInfo();
    if (gameInfo.gameState !== GameState.IN_PROGRESS) {
        console.log(`클라이언트 ${client.id} Red Light Green Light 결과 전송 실패: 메인 게임이 진행 중이 아님`);
        sendResponse(client, createErrorResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_RESULT, {
            message: '메인 게임이 진행 중이 아닙니다.',
            errorCode: 'GAME_NOT_IN_PROGRESS'
        }));
        return;
    }

    // MINIGAME 페이즈에서만 허용
    if (gameInfo.gamePhase !== GamePhase.MINIGAME) {
        console.log(`클라이언트 ${client.id} Red Light Green Light 결과 전송 실패: MINIGAME 페이즈가 아님`);
        sendResponse(client, createErrorResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_RESULT, {
            message: '현재 미니게임 진행 중이 아닙니다.',
            errorCode: 'NOT_MINIGAME_PHASE'
        }));
        return;
    }

    // 현재 게임이 Red Light Green Light인지 확인
    if (gameInfo.currentMiniGame !== 'RED_LIGHT_GREEN_LIGHT') {
        console.log(`클라이언트 ${client.id} Red Light Green Light 결과 전송 실패: 현재 게임이 Red Light Green Light가 아님`);
        sendResponse(client, createErrorResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_RESULT, {
            message: '현재 Red Light Green Light 게임이 진행 중이 아닙니다.',
            errorCode: 'NOT_REDLIGHT_GREENLIGHT_GAME'
        }));
        return;
    }

    // 요청 데이터 검증
    if (typeof data.isSuccess !== 'boolean') {
        console.log(`클라이언트 ${client.id} Red Light Green Light 결과 전송 실패: 잘못된 데이터 형식`);
        sendResponse(client, createErrorResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_RESULT, {
            message: 'isSuccess 필드가 올바르지 않습니다.',
            errorCode: 'INVALID_DATA_FORMAT'
        }));
        return;
    }

    // 플레이어의 인덱스 가져오기
    const playerIndex = roomManager.getPlayerIndex(client.id);
    if (playerIndex === -1) {
        console.log(`클라이언트 ${client.id} Red Light Green Light 결과 전송 실패: 플레이어 인덱스를 찾을 수 없음`);
        sendResponse(client, createErrorResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_RESULT, {
            message: '플레이어 정보를 찾을 수 없습니다.',
            errorCode: 'PLAYER_NOT_FOUND'
        }));
        return;
    }

    console.log(`클라이언트 ${client.id} (인덱스: ${playerIndex}) Red Light Green Light 결과: ${data.isSuccess ? '성공' : '실패'}`);

    // GameManager에 결과 전달 (게임 클래스에서 중복 체크와 브로드캐스트 처리)
    console.log(`[DEBUG] GameManager.handlePlayerAction 호출 시작: playerId=${client.id}, success=${data.isSuccess}`);
    const success = gameManager.handlePlayerAction(client.id, {
        success: data.isSuccess,
        timeTaken: 0 // 추후 필요시 클라이언트에서 전송받도록 확장 가능
    });
    console.log(`[DEBUG] GameManager.handlePlayerAction 결과: ${success}`);

    if (!success) {
        console.log(`클라이언트 ${client.id} Red Light Green Light 결과 전송 실패: 이미 결과를 제출했거나 처리 실패`);
        
        // 실패 시에도 모든 플레이어에게 브로드캐스트 (처리 실패 상태로)
        roomManager.broadcast({
            code: ResponseCode.SUCCESS,
            signal: ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_RESULT,
            data: {
                playerIndex: playerIndex,
                isSuccess: false // 처리 실패는 게임 실패로 간주
            }
        });
        
        console.log(`플레이어 결과 브로드캐스트 (처리 실패): 플레이어 ${playerIndex} - 실패`);
        
        // 요청한 플레이어에게는 에러 응답도 전송
        sendResponse(client, createErrorResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_RESULT, {
            message: '게임 결과 처리에 실패했습니다. 이미 결과를 제출했을 수 있습니다.',
            errorCode: 'PROCESSING_FAILED'
        }));
        return;
    }

    console.log(`Red Light Green Light 게임 결과 처리 완료: 플레이어 ${playerIndex} - ${data.isSuccess ? '성공' : '실패'}`);
}

// Red Light Green Light 게임 플레이어 위치 처리
function handleRedLightGreenLightPlayerPosition(client: Client, data: any): void {
    console.log(`클라이언트 ${client.id}가 Red Light Green Light 위치 정보를 전송했습니다.`);
    
    // 클라이언트가 방에 있는지 확인
    if (!client.isInRoom) {
        console.log(`클라이언트 ${client.id} Red Light Green Light 위치 전송 실패: 방에 참여하지 않음`);
        sendResponse(client, createErrorResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_POSITION, {
            message: '방에 참여하지 않은 상태에서는 위치 정보를 전송할 수 없습니다.',
            errorCode: 'NOT_IN_ROOM'
        }));
        return;
    }

    // 게임이 진행 중인지 확인
    const gameInfo = gameManager.getGameInfo();
    if (gameInfo.gameState !== GameState.IN_PROGRESS) {
        console.log(`클라이언트 ${client.id} Red Light Green Light 위치 전송 실패: 메인 게임이 진행 중이 아님`);
        sendResponse(client, createErrorResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_POSITION, {
            message: '메인 게임이 진행 중이 아닙니다.',
            errorCode: 'GAME_NOT_IN_PROGRESS'
        }));
        return;
    }

    // MINIGAME 페이즈에서만 허용
    if (gameInfo.gamePhase !== GamePhase.MINIGAME) {
        console.log(`클라이언트 ${client.id} Red Light Green Light 위치 전송 실패: MINIGAME 페이즈가 아님`);
        sendResponse(client, createErrorResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_POSITION, {
            message: '현재 미니게임 진행 중이 아닙니다.',
            errorCode: 'NOT_MINIGAME_PHASE'
        }));
        return;
    }

    // 현재 게임이 Red Light Green Light인지 확인
    if (gameInfo.currentMiniGame !== 'RED_LIGHT_GREEN_LIGHT') {
        console.log(`클라이언트 ${client.id} Red Light Green Light 위치 전송 실패: 현재 게임이 Red Light Green Light가 아님`);
        sendResponse(client, createErrorResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_POSITION, {
            message: '현재 Red Light Green Light 게임이 진행 중이 아닙니다.',
            errorCode: 'NOT_REDLIGHT_GREENLIGHT_GAME'
        }));
        return;
    }

    // 요청 데이터 검증
    if (typeof data.progress !== 'number' || !Number.isInteger(data.progress)) {
        console.log(`클라이언트 ${client.id} Red Light Green Light 위치 전송 실패: 잘못된 데이터 형식 (정수가 아님)`);
        sendResponse(client, createErrorResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_POSITION, {
            message: 'progress 필드는 정수여야 합니다.',
            errorCode: 'INVALID_DATA_FORMAT'
        }));
        return;
    }

    // progress 값 범위 확인 (0~1000)
    if (data.progress < 0 || data.progress > 1000) {
        console.log(`클라이언트 ${client.id} Red Light Green Light 위치 전송 실패: progress 값이 범위를 벗어남 (${data.progress})`);
        sendResponse(client, createErrorResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_POSITION, {
            message: 'progress 값은 0과 1000 사이의 정수여야 합니다.',
            errorCode: 'INVALID_PROGRESS_VALUE'
        }));
        return;
    }

    // 게임 인스턴스에서 위치 업데이트
    const redLightGreenLightGame = gameManager.getCurrentMiniGameInstance();
    if (redLightGreenLightGame instanceof RedLightGreenLightGame) {
        const success = redLightGreenLightGame.updatePlayerPosition(client.id, data.progress);
        
        if (success) {
            console.log(`클라이언트 ${client.id} 위치 업데이트 성공: ${data.progress}/1000`);
            
            // 위치 업데이트 성공 시 모든 플레이어의 현재 위치 정보를 해당 클라이언트에게 응답
            const currentPositions = redLightGreenLightGame.getCurrentPlayerPositions();
            sendResponse(client, createSuccessResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_POSITION, {
                progress: currentPositions
            }));
            
            console.log(`위치 업데이트 응답 전송: [${currentPositions.join(', ')}]`);
        } else {
            // 실패 응답 전송
            sendResponse(client, createErrorResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_POSITION, {
                message: '위치 업데이트에 실패했습니다. 이미 게임을 완료했을 수 있습니다.',
                errorCode: 'UPDATE_FAILED'
            }));
            
            console.log(`클라이언트 ${client.id} 위치 업데이트 실패`);
        }
    } else {
        console.error('Red Light Green Light 게임 인스턴스를 찾을 수 없습니다!');
        sendResponse(client, createErrorResponse(ResponseSignal.REDLIGHTGREENLIGHT_PLAYER_POSITION, {
            message: '게임 인스턴스를 찾을 수 없습니다.',
            errorCode: 'GAME_INSTANCE_NOT_FOUND'
        }));
    }
}

// GameManager 이벤트 핸들러 설정 (재사용 가능한 함수)
function setupGameManagerEventHandlers(): void {
    gameManager.setEventHandlers({
        onGameStateChange: (state: GameState, phase: GamePhase) => {
            console.log(`게임 상태 변경: ${GameState[state]} - ${GamePhase[phase]}`);
            
            // 미니게임 준비 페이즈가 시작되면 선택된 게임에 따라 시작 패킷 전송
            if (state === GameState.IN_PROGRESS && phase === GamePhase.PREPARE) {
                const gameInfo = gameManager.getGameInfo();
                const currentGameType = gameInfo.currentMiniGame;
                
                if (currentGameType === 'TUG_OF_WAR') {
                    startTugOfWarGame();
                } else if (currentGameType === 'DALGONA') {
                    startDalgonaGame();
                } else if (currentGameType === 'RED_LIGHT_GREEN_LIGHT') {
                    startRedLightGreenLightGameFromClass();
                }
            }
            
            // 실제 미니게임 페이즈가 시작되면 게임 타입에 따라 인터벌 시작
            if (state === GameState.IN_PROGRESS && phase === GamePhase.MINIGAME) {
                const gameInfo = gameManager.getGameInfo();
                const currentGameType = gameInfo.currentMiniGame;
                
                if (currentGameType === 'TUG_OF_WAR') {
                    startTugOfWarGameInterval();
                } else if (currentGameType === 'RED_LIGHT_GREEN_LIGHT') {
                    startRedLightGreenLightIntervalFromClass();
                }
                // 달고나 게임은 별도 인터벌이 필요없음 (클라이언트 독립 실행)
            }
            
            // 미니게임이 끝나면 미니게임 인터벌과 타이머 정리
            if (phase !== GamePhase.MINIGAME) {
                if (tugOfWarGameInterval) {
                    clearInterval(tugOfWarGameInterval);
                    tugOfWarGameInterval = null;
                }
                if (tugOfWarGameTimer) {
                    clearTimeout(tugOfWarGameTimer);
                    tugOfWarGameTimer = null;
                }
                if (redLightGreenLightTimer) {
                    clearTimeout(redLightGreenLightTimer);
                    redLightGreenLightTimer = null;
                }
                if (redLightGreenLightGameTimer) {
                    clearTimeout(redLightGreenLightGameTimer);
                    redLightGreenLightGameTimer = null;
                }
                console.log('미니게임 인터벌과 타이머 정리 완료');
            }
        },
        onPlayerEliminated: (eliminatedPlayers: string[]) => {
            console.log(`플레이어 탈락: ${eliminatedPlayers.join(', ')}`);
            // 탈락 알림 패킷 전송 (추후 구현)
        },
        onGameEnd: (winnerId: string | null) => {
            console.log(`게임 종료: 우승자 ${winnerId || '없음'}`);
            
            // 미니게임 인터벌과 타이머 정리
            if (tugOfWarGameInterval) {
                clearInterval(tugOfWarGameInterval);
                tugOfWarGameInterval = null;
            }
            if (tugOfWarGameTimer) {
                clearTimeout(tugOfWarGameTimer);
                tugOfWarGameTimer = null;
            }
            if (redLightGreenLightTimer) {
                clearTimeout(redLightGreenLightTimer);
                redLightGreenLightTimer = null;
            }
            if (redLightGreenLightGameTimer) {
                clearTimeout(redLightGreenLightGameTimer);
                redLightGreenLightGameTimer = null;
            }
            console.log('게임 종료 - 미니게임 인터벌과 타이머 정리 완료');
            
            // 우승자의 플레이어 인덱스 구하기
            let winnerPlayerIndex = -1;
            if (winnerId) {
                winnerPlayerIndex = roomManager.getPlayerIndex(winnerId);
            }
            
            // 모든 플레이어에게 GAME_ENDED 응답 전송
            roomManager.broadcast({
                code: ResponseCode.SUCCESS,
                signal: ResponseSignal.GAME_ENDED,
                data: {
                    winnerPlayerIndex: winnerPlayerIndex
                }
            });
            
            console.log(`게임 종료 패킷 브로드캐스트 완료: 우승자 플레이어 인덱스 ${winnerPlayerIndex}`);
            
            // 5초 후 방 초기화 (플레이어들이 결과를 확인할 시간 제공)
            setTimeout(() => {
                resetGameRoom();
            }, 5000);
        },
        onSubGameReady: () => {
            console.log('모든 플레이어가 서브게임 준비 완료! ResponseReadySubGame 브로드캐스트');
            // 모든 플레이어에게 READY_SUBGAME 응답 브로드캐스트
            roomManager.broadcast({
                code: ResponseCode.SUCCESS,
                signal: ResponseSignal.READY_SUBGAME,
                data: {}
            });
            
            // 실제 미니게임 시작
            gameManager.startCurrentMiniGame();
        }
    });
    
    console.log('게임 방 초기화 완료 - 새로운 플레이어가 입장할 수 있습니다');
}

// 간단한 게임 방 초기화 함수
function resetGameRoom(): void {
    console.log('게임 방 초기화 시작');
    
    // 게임 상태 관련 변수들 초기화
    dalgonaGameResults.clear();
    tugOfWarLeftTeam = [];
    tugOfWarRightTeam = [];
    tugOfWarLeftTeamScore = 0;
    tugOfWarRightTeamScore = 0;
    redLightOn = true; // Red Light Green Light 상태 초기화
    
    // 모든 게임 타이머와 인터벌 정리
    if (dalgonaGameTimer) {
        clearTimeout(dalgonaGameTimer);
        dalgonaGameTimer = null;
    }
    if (tugOfWarGameInterval) {
        clearInterval(tugOfWarGameInterval);
        tugOfWarGameInterval = null;
    }
    if (tugOfWarGameTimer) {
        clearTimeout(tugOfWarGameTimer);
        tugOfWarGameTimer = null;
    }
    if (redLightGreenLightTimer) {
        clearTimeout(redLightGreenLightTimer);
        redLightGreenLightTimer = null;
    }
    if (redLightGreenLightGameTimer) {
        clearTimeout(redLightGreenLightGameTimer);
        redLightGreenLightGameTimer = null;
    }
    
    // GameManager 리셋 (게임 상태 초기화)
    gameManager.resetGame();
    
    // Room 초기화 (모든 클라이언트 제거)
    const allClientIds = roomManager.getAllClientIds();
    for (const clientId of allClientIds) {
        roomManager.removeClient(clientId);
    }
    
    // Room 상태를 WAITING으로 초기화
    roomManager.globalRoom.endGame();
    
    console.log('게임 방 초기화 완료 - 새로운 플레이어가 입장할 수 있습니다');
}

// 모든 플레이어가 달고나 게임 결과를 전송했는지 확인
function checkDalgonaGameComplete(): void {
    const totalPlayers = roomManager.getPlayerCount();
    const submittedResults = dalgonaGameResults.size;
    
    console.log(`달고나 게임 결과 수집 상황: ${submittedResults}/${totalPlayers}`);
    
    if (submittedResults === totalPlayers && totalPlayers > 0) {
        console.log('모든 플레이어가 달고나 게임 결과를 전송했습니다.');
        
        // 달고나 게임 타이머 정리 (모든 플레이어가 일찍 완료함)
        if (dalgonaGameTimer) {
            clearTimeout(dalgonaGameTimer);
            dalgonaGameTimer = null;
            console.log('모든 플레이어 완료로 인한 달고나 게임 타이머 정리');
        }
        
        // 결과 추적 맵 초기화 (다음 게임을 위해)
        dalgonaGameResults.clear();
        
        // GameManager에게 미니게임 종료 알림 (탈락 처리를 위해)
        setTimeout(() => {
            gameManager.endCurrentMiniGame();
        }, 2000); // 2초 후 게임 종료 (플레이어들이 결과를 확인할 시간 제공)
    }
}

// 달고나 게임 결과 처리
function handleDalgonaGameResult(client: Client, data: any): void {
    console.log(`클라이언트 ${client.id}가 달고나 게임 결과를 전송했습니다.`);
    
    // 클라이언트가 방에 있는지 확인
    if (!client.isInRoom) {
        console.log(`클라이언트 ${client.id} 달고나 결과 전송 실패: 방에 참여하지 않음`);
        sendResponse(client, createErrorResponse(ResponseSignal.DALGONA_GAME_RESULT, {
            message: '방에 참여하지 않은 상태에서는 게임 결과를 전송할 수 없습니다.',
            errorCode: 'NOT_IN_ROOM'
        }));
        return;
    }

    // 게임이 진행 중인지 확인
    const gameInfo = gameManager.getGameInfo();
    if (gameInfo.gameState !== GameState.IN_PROGRESS) {
        console.log(`클라이언트 ${client.id} 달고나 결과 전송 실패: 메인 게임이 진행 중이 아님`);
        sendResponse(client, createErrorResponse(ResponseSignal.DALGONA_GAME_RESULT, {
            message: '메인 게임이 진행 중이 아닙니다.',
            errorCode: 'GAME_NOT_IN_PROGRESS'
        }));
        return;
    }

    // MINIGAME 페이즈에서만 허용
    if (gameInfo.gamePhase !== GamePhase.MINIGAME) {
        console.log(`클라이언트 ${client.id} 달고나 결과 전송 실패: MINIGAME 페이즈가 아님`);
        sendResponse(client, createErrorResponse(ResponseSignal.DALGONA_GAME_RESULT, {
            message: '현재 미니게임 진행 중이 아닙니다.',
            errorCode: 'NOT_MINIGAME_PHASE'
        }));
        return;
    }

    // 요청 데이터 검증
    if (typeof data.isSuccess !== 'boolean') {
        console.log(`클라이언트 ${client.id} 달고나 결과 전송 실패: 잘못된 데이터 형식`);
        sendResponse(client, createErrorResponse(ResponseSignal.DALGONA_GAME_RESULT, {
            message: 'isSuccess 필드가 올바르지 않습니다.',
            errorCode: 'INVALID_DATA_FORMAT'
        }));
        return;
    }

    // 플레이어의 인덱스 가져오기
    const playerIndex = roomManager.getPlayerIndex(client.id);
    if (playerIndex === -1) {
        console.log(`클라이언트 ${client.id} 달고나 결과 전송 실패: 플레이어 인덱스를 찾을 수 없음`);
        sendResponse(client, createErrorResponse(ResponseSignal.DALGONA_GAME_RESULT, {
            message: '플레이어 정보를 찾을 수 없습니다.',
            errorCode: 'PLAYER_NOT_FOUND'
        }));
        return;
    }

    console.log(`클라이언트 ${client.id} (인덱스: ${playerIndex}) 달고나 결과: ${data.isSuccess ? '성공' : '실패'}`);

    // 중복 결과 제출 방지
    if (dalgonaGameResults.has(client.id)) {
        console.log(`클라이언트 ${client.id} 달고나 결과 전송 실패: 이미 결과를 제출함`);
        sendResponse(client, createErrorResponse(ResponseSignal.DALGONA_GAME_RESULT, {
            message: '이미 게임 결과를 제출했습니다.',
            errorCode: 'ALREADY_SUBMITTED'
        }));
        return;
    }

    // 결과 저장
    dalgonaGameResults.set(client.id, data.isSuccess);

    // GameManager에 결과 전달 (추후 게임 로직 처리용)
    gameManager.handlePlayerAction(client.id, {
        success: data.isSuccess,
        timeTaken: 0 // 추후 필요시 클라이언트에서 전송받도록 확장 가능
    });

    // 모든 플레이어에게 결과 브로드캐스트
    roomManager.broadcast({
        code: ResponseCode.SUCCESS,
        signal: ResponseSignal.DALGONA_GAME_RESULT,
        data: {
            playerIndex: playerIndex,
            isSuccess: data.isSuccess
        }
    });

    console.log(`달고나 게임 결과 브로드캐스트 완료: 플레이어 ${playerIndex} - ${data.isSuccess ? '성공' : '실패'}`);
    
    // 모든 플레이어의 결과가 수집되었는지 확인
    checkDalgonaGameComplete();
}

// 줄다리기 게임 버튼 클릭 횟수 처리
function handleTugOfWarGamePressCount(client: Client, data: any): void {
    console.log(`클라이언트 ${client.id}가 줄다리기 버튼 클릭 횟수를 전송했습니다.`);
    
    // 게임 상태 확인
    const gameInfo = gameManager.getGameInfo();
    if (gameInfo.gameState !== GameState.IN_PROGRESS || gameInfo.gamePhase !== GamePhase.MINIGAME) {
        console.log(`클라이언트 ${client.id} 줄다리기 결과 전송 실패: MINIGAME 페이즈가 아님`);
        sendResponse(client, createErrorResponse(ResponseSignal.TUGOFWAR_GAME_PRESS_COUNT, {
            message: '현재 미니게임 페이즈가 아닙니다.'
        }));
        return;
    }
    
    // 클라이언트의 플레이어 인덱스 확인
    const playerIndex = roomManager.getPlayerIndex(client.id);
    if (playerIndex === -1) {
        console.log(`클라이언트 ${client.id} 줄다리기 결과 전송 실패: 유효하지 않은 플레이어`);
        sendResponse(client, createErrorResponse(ResponseSignal.TUGOFWAR_GAME_PRESS_COUNT, {
            message: '유효하지 않은 플레이어입니다.'
        }));
        return;
    }
    
    // 어느 팀에 속하는지 확인하고 점수 추가
    const pressCount = data.pressCount || 0;
    
    if (tugOfWarLeftTeam.includes(playerIndex)) {
        tugOfWarLeftTeamScore += pressCount;
        console.log(`왼쪽 팀 플레이어 ${playerIndex}가 버튼을 ${pressCount}번 클릭했습니다. 왼쪽 팀 총 점수: ${tugOfWarLeftTeamScore}`);
    } else if (tugOfWarRightTeam.includes(playerIndex)) {
        tugOfWarRightTeamScore += pressCount;
        console.log(`오른쪽 팀 플레이어 ${playerIndex}가 버튼을 ${pressCount}번 클릭했습니다. 오른쪽 팀 총 점수: ${tugOfWarRightTeamScore}`);
    } else {
        console.log(`플레이어 ${playerIndex}는 어느 팀에도 속하지 않습니다 (자동 승리자일 수 있음)`);
        return;
    }
    
    // GameManager에 액션 전달 (TugOfWarGame이 기대하는 형식으로)
    gameManager.handlePlayerAction(client.id, {
        pullPower: pressCount,  // pressCount를 pullPower로 사용
        timestamp: Date.now()
    });
}

// WebSocket 연결 이벤트 처리
wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    // Client 객체 생성
    const client = new Client(ws, req);
    clients.set(client.id, client);
    
    console.log('새로운 클라이언트가 연결되었습니다:', client.getInfo());
    
    // 연결 확인 패킷 전송
    sendResponse(client, createSuccessResponse(ResponseSignal.PING, {
        message: 'Connected to game server',
        serverTime: Date.now(),
        clientId: client.id
    }));
    
    // 메시지 수신 처리
    ws.on('message', (message: WebSocket.Data) => {
        try {
            const request: RequestPacket = JSON.parse(message.toString());
            const { signal, data } = request;
            
            switch (signal) {
                case RequestSignal.PING:
                    handlePing(client, data);
                    break;
                    
                case RequestSignal.ENTER_ROOM:
                    handleEnterRoom(client, data);
                    break;
                    
                case RequestSignal.LEAVE_ROOM:
                    handleLeaveRoom(client, data);
                    break;
                    
                case RequestSignal.START_GAME:
                    handleStartGame(client);
                    break;
                    
                case RequestSignal.READY_GAME:
                    handleReadyGame(client);
                    break;
                    
                case RequestSignal.READY_SUBGAME:
                    handleReadySubGame(client);
                    break;
                    
                case RequestSignal.DALGONA_GAME_RESULT:
                    handleDalgonaGameResult(client, data);
                    break;
                    
                case RequestSignal.TUGOFWAR_GAME_PRESS_COUNT:
                    handleTugOfWarGamePressCount(client, data);
                    break;
                    
                case RequestSignal.REDLIGHTGREENLIGHT_PLAYER_RESULT:
                    handleRedLightGreenLightPlayerResult(client, data);
                    break;
                    
                case RequestSignal.REDLIGHTGREENLIGHT_PLAYER_POSITION:
                    handleRedLightGreenLightPlayerPosition(client, data);
                    break;
                    
                default:
                    sendResponse(client, createErrorResponse(signal, {
                        message: `Unknown signal: ${signal}`
                    }));
            }
        } catch (error) {
            console.error('Request 처리 중 에러:', error);
            sendResponse(client, createErrorResponse(0, {
                message: 'Internal server error'
            }));
        }
    });
    
    // 연결 해제 처리
    ws.on('close', () => {
        console.log('클라이언트 연결이 해제되었습니다:', client.getInfo());
        
        // 방에 있던 클라이언트라면 자동으로 방에서 제거
        if (roomManager.hasClient(client.id)) {
            // 게임이 진행 중이고 해당 플레이어가 생존해 있다면 탈락 처리
            const gameInfo = gameManager.getGameInfo();
            if (gameInfo.gameState === GameState.IN_PROGRESS) {
                gameManager.eliminatePlayerByDisconnection(client.id);
            }
            
            roomManager.removeClient(client.id);
            
            // 다른 플레이어들에게 플레이어 수 변경 알림 (대기 상태일 때만)
            if (gameInfo.gameState === GameState.WAITING) {
                roomManager.broadcast({
                    code: ResponseCode.SUCCESS,
                    signal: ResponseSignal.PLAYER_COUNT_CHANGED,
                    data: {
                        playerCount: roomManager.getPlayerCount()
                    }
                });
            }
        }
        
        client.disconnect();
        clients.delete(client.id);
    });
    
    // 에러 처리
    ws.on('error', (error: Error) => {
        console.error('소켓 에러:', error);
        
        // 방에 있던 클라이언트라면 자동으로 방에서 제거
        if (roomManager.hasClient(client.id)) {
            // 게임이 진행 중이고 해당 플레이어가 생존해 있다면 탈락 처리
            const gameInfo = gameManager.getGameInfo();
            if (gameInfo.gameState === GameState.IN_PROGRESS) {
                gameManager.eliminatePlayerByDisconnection(client.id);
            }
            
            roomManager.removeClient(client.id);
            
            // 다른 플레이어들에게 플레이어 수 변경 알림 (대기 상태일 때만)
            if (gameInfo.gameState === GameState.WAITING) {
                roomManager.broadcast({
                    code: ResponseCode.SUCCESS,
                    signal: ResponseSignal.PLAYER_COUNT_CHANGED,
                    data: {
                        playerCount: roomManager.getPlayerCount()
                    }
                });
            }
        }
        
        client.disconnect();
        clients.delete(client.id);
    });
});

// 서버 시작
server.listen(app.get('port'), () => {
    console.log(`게임 서버가 ${app.get('port')}번 포트에서 실행 중입니다.`);
    console.log('웹소켓 연결을 기다리고 있습니다...');
    console.log(`웹소켓 경로: /ws`);
});

