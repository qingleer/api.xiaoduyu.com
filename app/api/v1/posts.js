var Question = require('../../models').Question;
var Node = require('../../models').Node;
var User = require('../../models').User;
var Like = require('../../models').Like;

var Posts = require('../../models').Posts;
var Topic = require('../../models').Topic;
var Follow = require('../../models').Follow;

var Tools = require('../../common/tools');
var async = require('async');
var xss = require('xss');

import Promise from 'promise'

exports.add = function(req, res, next) {

  // 用户的信息
  var user        = req.user;
  var title       = req.body.title;
  var content     = req.body.detail;
  var contentHTML = req.body.detail_html;
  var topicId      = req.body.topic_id;
  var ip          = Tools.getIP(req);
  var deviceId    = req.body.device_id ? parseInt(req.body.device_id) : 1;
  var type        = req.body.type ? parseInt(req.body.type) : 1;

  // let { title, content, contentHTML, topicId, deviceId = 1, type = 1 } = req.body

  deviceId = parseInt(deviceId)
  type = parseInt(type)

  async.waterfall([

    // 判断ip是否存在
    (callback) => callback(!ip ? 10000 : null),

    (callback) => {

      // 判断是否禁言
      if (user && user.banned_to_post &&
        new Date(user.banned_to_post).getTime() > new Date().getTime()
      ) {
        let countdown = Countdown(new Date(), user.banned_to_post)
        callback({ error: 10008, error_data: countdown })
      } else {
        callback(null)
      }

    },

    // 不存在的类型
    (callback) => callback(type > 3 || type < 1 ? 11001 : null),

    // 标题合法性检测
    (callback) => {

      title = xss(title, {
        whiteList: {},
        stripIgnoreTag: true,
        onTagAttr: function (tag, name, value, isWhiteAttr) {
          return '';
        }
      })

      if (!title || title.replace(/(^\s*)|(\s*$)/g, "") == '') {
        // 标题不能为空
        callback(11002)
      } else if (title.length > 120) {
        // 标题不能大于120个字符
        callback(11003)
      } else {
        callback(null)
      }
    },

    // 内容合法性检测
    (callback) => {

      content = xss(content, {
        whiteList: {},
        stripIgnoreTag: true,
        onTagAttr: function (tag, name, value, isWhiteAttr) {
          return '';
        }
      });

      contentHTML = xss(contentHTML, {
        whiteList: {
          a: ['href', 'title', 'target', 'rel'],
          img: ['src', 'alt'],
          p: [], div: [], br: [], blockquote: [], li: [], ol: [], ul: [],
          strong: [], em: [], u: [], pre: [], b: [], h1: [], h2: [], h3: [],
          h4: [], h5: [], h6: [], h7: []
        },
        stripIgnoreTag: true,
        onIgnoreTagAttr: function (tag, name, value, isWhiteAttr) {
          if (tag == 'div' && name.substr(0, 5) === 'data-') {
            // 通过内置的escapeAttrValue函数来对属性值进行转义
            return name + '="' + xss.escapeAttrValue(value) + '"';
          }
        }
      })

      callback(contentHTML.length > 20000 ? 11004 : null)
    },

    // 话题是否存在
    (callback) => {

      if (!topicId) return callback(15000)

      Topic.fetch({ _id: topicId }, {}, {}, function(err, data){
        if (err) console.log(err);
        if (!data || data.length == 0) {
          callback(15000);
        } else {
          callback(null);
        }
      });

    },

    // 添加
    (callback)=>{

      Posts.add({
        user_id: user._id,
        title: title,
        content: content,
        content_html: contentHTML,
        topic_id: topicId,
        ip: ip,
        device: deviceId,
        type: type,
        last_comment_at: new Date().getTime()
      }, function(err, posts){
        if (err) console.log(err);

        posts.create_at = new Date(posts.create_at).getTime();

        global.io.sockets.emit('new-posts', posts.create_at - 1);

        callback(null, posts);
      });

    },

    // 更新父节点children的
    (posts, callback) => {

      Topic.update({ _id: topicId }, { $inc: { 'posts_count': 1 } }, function(err){
        if (err) console.log(err)

        User.update({ _id: user._id }, { $inc: { 'posts_count': 1 } }, function(err){
          if (err) console.log(err)

          callback(null, posts);
        })

      })

    }

  ], (err, posts) => {

    if (err) {
      res.status(400)

      if (typeof err == 'number') {
        res.send({
          success: false,
          error: err
        })
      } else {
        err.success = false
        res.send(err)
      }

    } else {
      res.send({ success: true, data: posts });
    }

  });

};


exports.update = function(req, res, next) {

  // 用户的信息
  var user        = req.user || null
  var type        = req.body.type
  var topicId     = req.body.topic_id
  var id          = req.body.id
  var title       = req.body.title
  var content     = req.body.content
  var contentHTML = req.body.content_html
  var ip          = Tools.getIP(req)

  type = parseInt(type)

  async.waterfall([

    // 判断ip是否存在
    (callback) => !ip ? callback(10000) : callback(null),
    // 帖子类型
    (callback) => !type || type > 3 ? callback(11001) : callback(null),
    (callback) => !id ? callback(11000) : callback(null),
    // 话题是否存在
    (callback) => {
      // 回复没有话题
      if (!topicId) return callback(15000)

      Topic.fetch({ _id: topicId }, {}, {}, function(err, data){
        if (err) console.log(err);
        if (!data || data.length == 0) {
          callback(15000)
        } else {
          callback(null);
        }
      })
    },

    // 标题
    (callback) => {
      if (!title) {
        callback(11002)
      } else if (title.length > 120) {
        callback(11003)
      } else {

        title = xss(title, {
          whiteList: {},
          stripIgnoreTag: true,
          onTagAttr: function (tag, name, value, isWhiteAttr) {
            return ''
          }
        })

        if (!title) return callback(11002)
        callback(null)
      }
    },

    // 内容长度
    (callback) => {
      if (contentHTML.length > 20000) {
        callback(11004)
      } else {

        content = xss(content, {
          whiteList: {},
          stripIgnoreTag: true,
          onTagAttr: function (tag, name, value, isWhiteAttr) {
            return '';
          }
        })

        contentHTML = xss(contentHTML, {
          whiteList: {
            a: ['href', 'title', 'target', 'rel'],
            img: ['src', 'alt'],
            p: [],
            div: [],
            br: [],
            blockquote: [],
            li: [],
            ol: [],
            ul: [],
            strong: [],
            em: [],
            u: [],
            pre: [],
            b: [],
            h1: [],
            h2: [],
            h3: [],
            h4: [],
            h5: [],
            h6: [],
            h7: []
          },
          stripIgnoreTag: true,
          onIgnoreTagAttr: function (tag, name, value, isWhiteAttr) {
            if (tag == 'div' && name.substr(0, 5) === 'data-') {
              // 通过内置的escapeAttrValue函数来对属性值进行转义
              return name + '="' + xss.escapeAttrValue(value) + '"';
            }
          }
        })

        callback(null)
      }
    },

    (callback) => {

      Posts.update(
      { _id: id },
      {
        type: type,
        topic_id: topicId,
        title: title,
        content: content,
        content_html: contentHTML,
        update_at: new Date()
      }, function(err, result){

        if (err) {
          console.log(err)
          callback(11005);
        } else {
          callback(null)
        }
      })

    }

  ], function(err, result){

    if (err) {
      res.status(400);
      res.send({
        success: false,
        error: err
      });
    } else {
      res.send({
        success: true
        // data: result
      });
    }

  });

};


exports.fetch = function(req, res, next) {

  var user = req.user || null,
      page = parseInt(req.query.page) || 0,
      perPage = parseInt(req.query.per_page) || 20,
      userId = req.query.user_id,
      topicId = req.query.topic_id || '',
      postsId = req.query.posts_id || '',
      // 大于创建日期
      gtCreateAt = req.query.gt_create_at  ? parseInt(req.query.gt_create_at) : null,
      gtDate = req.query.gt_date ? parseInt(req.query.gt_date) : null,
      ltDate = req.query.lt_date ? parseInt(req.query.lt_date) : null,
      or = req.query.or || true,
      draft = req.query.draft || false,
      method = req.query.method || '', // user_custom 根据用户偏好查询、
      weaken = req.query.weaken,

      // 是否包含部分评论一起返回
      includeComments = req.query.include_comments || 0,
      commentsLimit = parseInt(req.query.comments_limit) || 5,
      commentsSort = req.query.comments_sort || 'reply_count:-1,like_count:-1',

      postsSort = req.query.posts_sort || 'sort_by_date:-1',

      sortBy = req.query.sort_by || 'sort_by_date',
      sort = req.query.sort || -1,
      device = req.query.device || '',

      query = {},
      select = {},
      options = {};

      // console.log(req.query.include_comments);

  /**
   * 增加屏蔽条件
   *
   * 如果是登陆状态，那么增加屏蔽条件
   * 如果通过posts查询，那么不增加屏蔽条件
   */
  if (user && !postsId) {
    if (user.block_posts_count > 0) query._id = { '$nin': user.block_posts }
    if (user.block_people_count > 0) query.user_id = { '$nin': user.block_people }
  }

  if (commentsLimit > 100) commentsLimit = 100
  if (perPage > 100) perPage = 100

  var _commentsSort = {}

  commentsSort.split(',').map((item)=>{

    if (!item) {
      return
    }

    var i = item.split(':')
    _commentsSort[i[0]] = parseInt(i[1])
  })

  // console.log(_commentsSort);

  // ---- query -----

  if (or) {
    query['$or'] = []
  }

  // 根据用户的关注偏好获取帖子
  if (user && method == 'user_custom') {

    if (!user.follow_people.length && !user.follow_topic.length && !user.follow_posts.length) {
      res.send({
        success: true,
        data: []
      })
      return
    }

    // user.follow_people.push(user._id)
    userId = user.follow_people.join(',')

    // if (user.follow_topic.length > 0) {
    //   topicId = user.follow_topic.join(',')
    // }

    if (!user.follow_topic.length && device == '') {
      or = true
      var conf = { deleted: false }

      if (weaken) conf.weaken = false
      if (ltDate) conf.sort_by_date = { '$lt': ltDate }
      if (gtDate) conf.sort_by_date = { '$gt': gtDate }
      if (gtCreateAt) conf.create_at = { '$gt': gtCreateAt }

      query['$or'] = [conf]
    } else {
      topicId = user.follow_topic.join(',')
    }

    postsId = postsId + (postsId ? ',' : '') + user.follow_posts.join(',')

  }

  // 用户偏好
  if (userId) {
    if (or) {

      var conf = {
        user_id: {'$in': userId.split(',') },
        deleted: false
      }

      if (weaken) conf.weaken = false
      if (ltDate) conf.sort_by_date = { '$lt': ltDate }
      if (gtDate) conf.sort_by_date = { '$gt': gtDate }
      if (gtCreateAt) conf.create_at = { '$gt': gtCreateAt }

      query['$or'].push(conf)
    } else {
      query.user_id = { '$in': userId.split(',') }
    }
  }

  // 话题偏好
  if (topicId) {
    if (or) {

      var conf = {
        topic_id: {'$in': topicId.split(',') },
        deleted: false
      }

      if (weaken) conf.weaken = false
      if (ltDate) conf.sort_by_date = { '$lt': ltDate }
      if (gtDate) conf.sort_by_date = { '$gt': gtDate }
      if (gtCreateAt) conf.create_at = { '$gt': gtCreateAt }

      query['$or'].push(conf)
    } else {
      query.topic_id = { '$in': topicId.split(',') }
    }
  }

  // 指定的帖子
  if (postsId) {
    if (or) {
      var conf = {
        _id: {'$in': postsId.split(',') },
        deleted: false
      }

      if (ltDate) conf.sort_by_date = { '$lt': ltDate }
      if (gtDate) conf.sort_by_date = { '$gt': gtDate }
      if (gtCreateAt) conf.create_at = { '$gt': gtCreateAt }

      query['$or'].push(conf)
    } else {
      query._id = { '$in': postsId.split(',') }
    }
  }

  // 如果没有参数
  if (query['$or'].length == 0) {
    delete query['$or']
    query.deleted = false

    if (weaken) query.weaken = false
    if (ltDate) query.sort_by_date = { '$lt': ltDate }
    if (gtDate) query.sort_by_date = { '$gt': gtDate }
    if (gtCreateAt) query.create_at = { '$gt': gtCreateAt }
  }

  // ------- query end ------


  // ------- select --------

  select = { __v: 0, recommend: 0, verify: 0, deleted: 0, ip: 0, device: 0, content: 0, weaken: 0 }

  if (!includeComments) {
    select.comment = 0
  }

  if (draft) {
    delete select.content
  }

  // ------- select end --------


  // ------- options -------

  if (page > 0) {
    options.skip = page * perPage
  }

  options.limit = perPage

  options.sort = { }
  options.sort[sortBy] = sort

  options.populate = [
    {
      path: 'user_id',
      select: {
        '_id': 1, 'avatar': 1, 'nickname': 1, 'brief': 1
      }
    },
    {
      path: 'comment',
      match: {
        $or: [
          { deleted: false, weaken: false, like_count: { $gte: 2 } },
          { deleted: false, weaken: false, reply_count: { $gte: 1 } }
        ]
      },
      select: {
        '_id': 1, 'content_html': 1, 'create_at': 1, 'reply_count': 1, 'like_count': 1, 'user_id': 1, 'posts_id': 1
      },
      options: { limit: commentsLimit, sort:_commentsSort }
    },
    {
      path: 'topic_id',
      select: { '_id': 1, 'name': 1 }
    }
  ]

  /* 如果是管理员则显示一些额外的属性 */

  // if (user.role == 100) {
  //   if (typeof query.deleted != 'undefined') {
  //     delete query.deleted
  //   }
  //   delete select.deleted
  //   delete select.weaken
  //   delete select.recommend
  // }

  /* 管理员 end */

  // console.log(query);


  // ------- options end -------

  async.waterfall([

    function(callback) {

      Posts.find(query, select, options, function(err, posts){

        if (err) console.log(err);

        if (!posts || posts.length == 0) {
          callback([])
          return
        }

        var options = [
          {
            path: 'comment.user_id',
            model: 'User',
            select: { '_id': 1, 'avatar': 1, 'nickname': 1, 'brief': 1 }
          }
        ]

        Posts.populate(posts, options, function(err, posts){

          if (err) console.log(err);

          posts = JSON.stringify(posts);
          posts = JSON.parse(posts);

          if (postsId) {
            callback(null, posts)
            /*
            Posts.update({ _id: postsId }, { $inc: { view_count: 1 } }, function(err){
              if (err) console.log(err);
              callback(null, posts)
            })
            */
          } else {
            callback(null, posts)
          }

        })

      })
    },

    function(posts, callback) {

      if (!user) return callback(posts)

      // 如果是登录状态，那么查询是否关注了该问题

      var ids = []

      for (var i = 0, max = posts.length; i < max; i++) {
        ids.push(posts[i]._id)
      }

      Follow.fetch({
        user_id: user._id,
        posts_id: { "$in": ids },
        deleted: false
      }, { posts_id: 1 }, {}, function(err, follows){

        if (err) console.log(err)
        var ids = {}

        for (var i = 0, max = follows.length; i < max; i++) {
          ids[follows[i].posts_id] = 1
        }

        posts.map(function(question, key){
          posts[key].follow = ids[question._id] ? true : false
        })

        callback(null, posts)

      })

    },

    function(posts, callback) {

      if (!user) return callback(posts)

      // 如果是登录状态，那么查询是否赞了帖子

      var ids = []

      for (var i = 0, max = posts.length; i < max; i++) {
        ids.push(posts[i]._id)
      }

      Like.find({ user_id: user._id, type: 'posts', target_id: { "$in": ids }, deleted: false }, { _id: 0, target_id: 1 }, {}, function(err, likeList){
        if (err) console.log(err);

        var ids = {}

        likeList.map(like=>{
          ids[like.target_id] = 1
        })

        posts.map(function(item, key){
          posts[key].like = ids[item._id] ? true : false
        })

        callback(null, posts)

      })
    },

    function(posts, callback) {

      if (!user) return callback(posts)

      var ids = []

      for (var i = 0, max = posts.length; i < max; i++) {
        if (posts[i].comment) {
          posts[i].comment.map(function(comment){
            ids.push(comment._id)
          })
        }
      }

      Like.fetch({
        user_id: user._id,
        type: 'comment',
        target_id: { "$in": ids },
        deleted: false
      }, { target_id:1, _id:0 }, {}, function(err, likes){

        if (err) console.log(err)
        var ids = {}

        for (var i = 0, max = likes.length; i < max; i++) {
          ids[likes[i].target_id] = 1
        }

        for (var i = 0, max = posts.length; i < max; i++) {

          if (posts[i].comment) {
            posts[i].comment.map(function(comment, index){
              comment.like = ids[comment._id] ? true : false
              posts[i].comment[index] = comment
            })
          }

        }

        callback(posts)

      })

    }

  ], function(result){

    if (user && method == 'user_custom' && perPage != 1) {
      User.update({ _id: user._id }, { last_find_posts_at: new Date() }, err=>{})
    }

    res.send({
      success: true,
      data: result
    })

  })

}


exports.view = function(req, res, next) {
  var postsId = req.query.posts_id

  Posts.findOne({ _id: postsId }, { _id: 1 }, function(err, posts){
    if (err) console.log(err);
    if (posts) {
      Posts.update({ _id: postsId }, { $inc: { view_count: 1 } }, function(err){
        if (err) console.log(err);
        res.send({ success: true })
      })
    } else {
      res.send({ success: false })
    }
  })
}

exports.findPosts = async (req, res) => {
  const user = req.user
  let queryJSON = req.body.query_json || '{}'
  let selectJSON = req.body.select_json || '{}'
  let optionJSON = req.body.option_json || '{}'

  try {
    queryJSON = JSON.parse(queryJSON)
  } catch(err) {
    res.send({ error: 11000, success: false })
    return
  }

  try {
    selectJSON = JSON.parse(selectJSON)
  } catch(err) {
    res.send({ error: 11000, success: false })
    return
  }

  try {
    optionJSON = JSON.parse(optionJSON)
  } catch(err) {
    res.send({ error: 11000, success: false })
    return
  }

}


exports.adminUpdatePosts = async (req, res) => {
  const user = req.user
  const id = req.body.id || ''
  let dataJson = req.body.data_json || {}

  try {
    dataJson = JSON.parse(dataJson)
  } catch(err) {
    res.send({ error: 11000, success: false })
    return
  }

  // [白名单]允许修改的字段
  const whiteList = {
    deleted: data => new Promise((resolve) => {
      if (typeof data != 'boolean') {
        resolve({ err: 90000 })
      } else {
        resolve({ err: false, data })
      }
    }),
    weaken: data => new Promise((resolve) => {
      if (typeof data != 'boolean') {
        resolve({ err: 90000 })
      } else {
        resolve({ err: false, data })
      }
    }),
    topic_id: data => new Promise((resolve) => resolve({ err: false, data })),
    type: data => new Promise((resolve) => resolve({ err: false, data })),
    title: data => new Promise((resolve) => resolve({ err: false, data })),
    content: data => new Promise((resolve) => resolve({ err: false, data })),
    content_html: data => new Promise((resolve) => resolve({ err: false, data })),
    verify: data => new Promise((resolve) => resolve({ err: false, data })),
    recommend: data => new Promise((resolve) => resolve({ err: false, data })),
    sort_by_date: data => new Promise((resolve) => resolve({ err: false, data }))
  }

  let updateData = {}

  for (let i in dataJson) {
    if (whiteList[i]) {
      let result = await whiteList[i](dataJson[i])
      if (result && result.err) {
        res.send({ success: false, error: result.err })
        return
      } else {
        updateData[i] = result.data
      }
    }
  }

  Posts.update({ _id: id }, updateData, err=>{
    if (err) console.log(res);
    res.send({ success: true })
  })
}


function Countdown(nowDate, endDate) {

  var lastDate = Math.ceil(new Date(endDate).getTime()/1000)
  var now = Math.ceil(new Date(nowDate).getTime()/1000)
  var timeCount = lastDate - now
  var days = parseInt( timeCount / (3600*24) )
  var hours = parseInt( (timeCount - (3600*24*days)) / 3600 )
  var mintues = parseInt( (timeCount - (3600*24*days) - (hours*3600)) / 60)
  var seconds = timeCount - (3600*24*days) - (3600*hours) - (60*mintues)

  return {
    days: days,
    hours: hours,
    mintues: mintues,
    seconds: seconds
  }

}
