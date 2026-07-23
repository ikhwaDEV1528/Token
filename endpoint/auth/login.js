import express from 'express';
import parsingInput from '../../middleware/parsing_input/parsingInput.js';
import limit from '../../middleware/rate_limit/rateLimit.js';
import Logic from '../../controlers/logic.js';

import ChekingAdmin from '../../controlers/check_akses.js';
import test_req from '../../controlers/test_req.js';
import accsesToken from '../../middleware/accses.js';

import cheking_route from '../../middleware/cheking_route.js';


const router_login = express.Router(); // <--- Pakai express.Router()

router_login.post('/login' , limit ,  parsingInput , Logic)
router_login.post('/CHECKING_ADMIN' , ChekingAdmin)
router_login.get('/test' ,accsesToken, test_req)
router_login.post('/CHECKING_ROUTE' , cheking_route )

export default router_login;
