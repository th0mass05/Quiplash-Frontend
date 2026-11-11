'use strict';

//Set up express
const express = require('express');
const app = express();

//Setup socket.io
const server = require('http').Server(app);
const io = require('socket.io')(server);

require('dotenv').config();

//Setup static page handling
app.set('view engine', 'ejs');
app.use('/static', express.static('public'));

//Handle client interface on /
app.get('/', (req, res) => {
  res.render('client');
});
//Handle display interface on /display
app.get('/display', (req, res) => {
  res.render('display');
});





// URL of the backend API
const BACKEND_ENDPOINT = process.env.BACKEND || 'http://localhost:8181';
const AI_URL = process.env.AI_URL || 'https://openai.azure.com/';
const AI_KEY = process.env.AI_KEY || 'A';
const AI_MODEL = process.env.AI_MODEL || 'open-ai-quiplash';

const PHASES = {
  JOINING: "joining",
  PROMPTS: "prompts",
  ANSWERS: "answers",
  VOTING: "voting",
  RESULTS: "results",
  SCORES: "scores",
  GAME_OVER: "game_over"

};

const clients = new Map();

const game = {
  phase: PHASES.JOINING,
  round: 0,
  adminID: null,
  players: [],
  audience: [],
  prompts: [],
  answers: [],
  votes: [],
  currentPromptIndex: 0,
  preparing: false
}


async function generatePrompts(count){


  const reply = await AI_generate(`Create ${count} witty English Quiplash prompts, each 20–100 characters. ` +
      "Return only a JSON array of strings, without Markdown or answers."
    )
  
  const prompts = JSON.parse(reply)

  if (Array.isArray(prompts) && prompts.every(p => typeof p === 'string') && prompts.length === count) {
    if (prompts.every(p => p.trim().length >= 20 && p.trim().length <= 100)){
      const cleanedPrompts = prompts.map(p => p.trim())
      console.log("Valid prompts received: ", cleanedPrompts)
      return cleanedPrompts
    }
    else {
      throw new Error("AI prompts must each contain 20–100 characters.");
    }
  }
  else {throw new Error("Prompt format incorrect.");}
  

}

//Start the server
function startServer() {
    const PORT = process.env.PORT || 8080;
    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);

    });

    
}

//Chat message
function handleChat(message) {
    console.log('Handling chat: ' + message); 
    io.emit('chat',message);
}

function updatePlayer(socket){
  const participant = clients.get(socket.id);
  if (!participant) {
    return;
  }
  socket.emit("player-update", {phase: game.phase, round: game.round,
                                player: {username: participant.username, 
                                        role: participant.role, 
                                        isAdmin: game.adminID === socket.id,
                                        totalScore: participant.totalScore, 
                                        roundScore: participant.roundScore}});
  }

function updateAllPlayers() {
  for (const socket of io.sockets.sockets.values()) {
    updatePlayer(socket);
  }

  updatePublicState();
}

async function AI_generate(prompt) {
  const response = await fetch(`${AI_URL.replace(/\/+$/, '')}/openai/deployments/${AI_MODEL}/chat/completions?api-version=2024-12-01-preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': AI_KEY
    },
    body: JSON.stringify({
      messages: [{ role: "system", content: "You create witty prompts for a Quiplash-style game." }, 
      { role: "user", content: prompt }
      ],
      max_completion_tokens: 16384
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`AI API error: ${data.error?.message || 'Unknown error'}`);
  }
  return data.choices[0].message.content;
}

async function advancePhase() {
  
  const nextPhase = {
    [PHASES.JOINING]: PHASES.PROMPTS,
    [PHASES.PROMPTS]: PHASES.ANSWERS,
    [PHASES.ANSWERS]: PHASES.VOTING,
    [PHASES.VOTING]: PHASES.RESULTS,
    [PHASES.RESULTS]: PHASES.SCORES,
    [PHASES.SCORES]: PHASES.GAME_OVER
  }

  if (nextPhase[game.phase]) {
    const previousPhase = game.phase;

    try {
      endPhase(previousPhase);
      game.phase = nextPhase[previousPhase];

      await startPhase(game.phase);
      updateAllPlayers();
    } catch (error) {
      game.phase = previousPhase;
      updateAllPlayers();
      throw error;
    }
  }
}

function endPhase(phase){
  console.log(`Ending phase: ${phase}`);

}

async function startPhase(phase){
  console.log(`Starting phase: ${phase}`);
  if (phase === PHASES.PROMPTS){
    const prompts = await generatePrompts(3)
    for (const i of prompts){
      game.prompts.push({
        text: i,
        source: "ai",
        tags: []
      })

    }
    console.log("Prompt pool after AI generation:", game.prompts);
  }
}

function emitError(socket, msg){
  socket.emit("error", {msg: msg});
}

function updatePublicState(){
  io.emit("game-update", {phase: game.phase, round: game.round, players: game.players.map(participant => ({
                              username: participant.username, isAdmin: participant.socketID === game.adminID})), 
                          audienceCount: game.audience.length});
}

//Handle new connection
io.on('connection', socket => { 
  console.log('New connection');


  updatePublicState();

  //Handle on chat message received
  socket.on('chat', message => {
    handleChat(message);
  });




  // registration socket listener
  socket.on("register", async (data) => {
    try {
      // check data is object and both fields are strings
      if (data === null ||typeof data !== 'object' || Array.isArray(data) || typeof data.username !== 'string' || typeof data.password !== 'string') {
        socket.emit("register-response", {
        status: 400,
        data: { result: false, msg: "Invalid request" }});
        return;
      }

      const response = await registerPlayer(data.username, data.password);
      socket.emit("register-response", response);
    } catch (error) {
      console.error("Registration request failed:", error.message);
      socket.emit("register-response", { status: 502, data: { result: false, msg: "Registration request failed" } });
    }
  })

  // prompt handling

  

  socket.on("login", async (data) => {
    try {
      // check data is object and both fields are strings
      if (data === null ||typeof data !== 'object' || Array.isArray(data) || typeof data.username !== 'string' || typeof data.password !== 'string') {
        socket.emit("login-response", {
        status: 400,
        data: { result: false, msg: "Invalid request" }});
        return;
      }

      const response = await loginPlayer(data.username, data.password);
      if (response.status === 200 && response.data.result === true) {
        // add player to game 
        
        if (clients.has(socket.id)) {
          socket.emit("login-response", { status: 400, data: { result: false, msg: "Already logged in" } });
          return;
        }

        const alreadyJoined = [...game.players, ...game.audience].some(
          person => person.username.toLowerCase() === data.username.toLowerCase()
        );

        if (alreadyJoined) {
          socket.emit("login-response", { status: 400, data: { result: false, msg: "User already joined the game" } });
          return;
        }

        if (!alreadyJoined) {
          const participant = {
          username: data.username,
          socketID: socket.id,
          role: null,
          totalScore: 0,
          roundScore: 0
          };

          if (game.phase === PHASES.JOINING && game.players.length < 8) {
            if (game.adminID === null) {
              game.adminID = socket.id;
            }
            game.players.push(participant);
            participant.role = "player";
          } 
          else {
            game.audience.push(participant);
            participant.role = "audience";
          }

          clients.set(socket.id, participant);
          updateAllPlayers();
        }

      }
      socket.emit("login-response", response);
    } catch (error) {
      console.error("Login request failed:", error.message);
      socket.emit("login-response", { status: 502, data: { result: false, msg: "Login request failed" } });
    }
  })

  // next button socket listener

  socket.on("next", async () => {
    if (game.preparing){
      return;
    }

    if (socket.id !== game.adminID) {
      emitError(socket, "Only the admin can advance the phase.");
      return;
    }

    if (game.phase === PHASES.JOINING && game.players.length < 3) {
      emitError(socket, "At least 3 players are required to start the game.");
      return;
    }
    game.preparing = true
    try {
      await advancePhase();
      
    } catch (error) {
      console.error("Phase advance failed:", error.message);
      emitError(socket, "Could not prepare the next phase.");
    }finally {
      game.preparing = false;
    }
    
  });

  socket.on("prompt", async (data) => {

    
    const participant = clients.get(socket.id);

    if (!participant) {
      socket.emit("prompt-response", {
        status: 401,
        data: {
          result: false,
          msg: "You must log in before submitting a prompt."
        }
      });
      return;

    }
    if (game.phase === PHASES.JOINING || game.phase === PHASES.GAME_OVER) {
      socket.emit("prompt-response", {
        status: 400,
        data: {
          result: false,
          msg: "Can't submit prompts in this stage"
        }
      });
      return;
    }

    try {
      if (data === null ||typeof data !== 'object' || Array.isArray(data) || typeof data.text !== 'string' || !Array.isArray(data.tags) || !data.tags.every(tag => typeof tag === "string")) {
        socket.emit("prompt-response", {
        status: 400,
        data: { result: false, msg: "Invalid request" }});
        return;
      }
      const response = await createPrompt(participant.username, data.text, data.tags);
      
      
      if (response.status === 200 && response.data.result === true) {
        // store the prompt in the game state
        game.prompts.push({username: participant.username, text: data.text, tags: data.tags});
        console.log("Game prompt pool:", game.prompts);
      }
      socket.emit("prompt-response", response);

    }
    catch (error) {
      console.error("Prompt entry failed:", error.message);
      socket.emit("prompt-response", { status: 502, data: { result: false, msg: "Prompt entry failed" } });
    }

    
  });

  socket.on("answer", (data) => {
    // TODO: validate and store this player's answer
  });

  socket.on("vote", (data) => {
    // TODO: validate and store this participant's vote
  });

    //Handle disconnection
    socket.on('disconnect', () => {
      console.log('Dropped connection');
    });
  })

//Start server
if (module === require.main) {
  startServer();
}

module.exports = server;

// reusable back end requesr function

async function callBackend(endpoint, method, data){
  const url = BACKEND_ENDPOINT.replace(/\/+$/, '') + endpoint;
  const headers = {"Content-Type": "application/json"};

  // add azure key if needed
  if (process.env.BACKEND_KEY){
    headers['x-functions-key'] = process.env.BACKEND_KEY;
  }

  const response = await fetch(url, {
    method: method,
    headers: headers,
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(20000) // 20 second timeout
  });

  const response_data = await response.json();
  return {
    status: response.status,
    data: response_data
  }
}

// register

async function registerPlayer(username, password){
  return callBackend('/player/register', 'POST', {username: username, password: password});
}

async function loginPlayer(username, password){
  return callBackend('/player/login', "POST", {username: username, password: password}) 
}

async function updatePlayerStats(username, add_to_games_played, add_to_score){
  return callBackend('/player/update', 'PUT', {username: username, add_to_games_played: add_to_games_played, add_to_score: add_to_score})
}

async function createPrompt(username, text, tags){
  return callBackend('/prompt/create', 'POST', {username: username, text: text, tags: tags})
}

async function getPrompts(players, tag_list){
  return callBackend('/utils/get', 'POST', {players: players, tag_list: tag_list})
}

async function moderatePrompts(promptIDs){
  return callBackend('/prompt/moderate', 'POST', {'prompt-ids': promptIDs})
}

async function deletePrompts(username){
  return callBackend('/prompt/delete', 'POST', {username: username})
}